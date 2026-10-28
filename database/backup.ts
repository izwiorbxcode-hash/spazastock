import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import db, {
  CURRENT_SCHEMA_VERSION,
  getAllCashUps,
  getAllCopilotEvents,
  getAllPayments,
  getAllProducts,
  getAllSales,
  getAllSettings,
} from "@/database/db";
import type { BackupPayload, CashUpRecord, CopilotEvent, CreditPayment, Product, Sale } from "@/types";

const BACKUP_APP_ID = "spaza-stock";

function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInteger(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? Math.trunc(value) : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildBackupPayload(): BackupPayload {
  return {
    version: CURRENT_SCHEMA_VERSION,
    app: BACKUP_APP_ID,
    exportedAt: new Date().toISOString(),
    data: {
      products: getAllProducts(),
      sales: getAllSales(),
      cashUps: getAllCashUps(),
      payments: getAllPayments(),
      copilotEvents: getAllCopilotEvents(),
      settings: getAllSettings(),
    },
  };
}

function isBackupPayload(value: unknown): value is BackupPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<BackupPayload>;
  return (
    candidate.app === BACKUP_APP_ID &&
    typeof candidate.version === "number" &&
    typeof candidate.data === "object" &&
    candidate.data !== null
  );
}

function migrateBackupPayload(payload: BackupPayload): BackupPayload {
  if (payload.version > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      "This backup was created by a newer version of Spaza OS. Please update the app and try again.",
    );
  }

  if (payload.version < 1) {
    throw new Error("This backup file is not valid.");
  }

  // Apply future in-memory migrations here, e.g.:
  // if (payload.version === 1) { payload = { ...payload, data: upgradeV1ToV2(payload.data) }; }

  return {
    ...payload,
    data: {
      products: payload.data.products ?? [],
      sales: payload.data.sales ?? [],
      cashUps: payload.data.cashUps ?? [],
      payments: payload.data.payments ?? [],
      copilotEvents: payload.data.copilotEvents ?? [],
      settings: payload.data.settings ?? {},
    },
  };
}

export function importBackupPayload(payload: unknown): number {
  if (!isBackupPayload(payload)) {
    throw new Error("This file is not a Spaza OS backup.");
  }

  const migrated = migrateBackupPayload(payload);
  const { products, sales, cashUps, payments, copilotEvents, settings } = migrated.data;

  db.withTransactionSync(() => {
    db.execSync("DELETE FROM products;");
    db.execSync("DELETE FROM sales;");
    db.execSync("DELETE FROM cashups;");
    db.execSync("DELETE FROM payments;");
    db.execSync("DELETE FROM copilot_events;");
    db.execSync("DELETE FROM settings;");

    for (const product of products) {
      db.runSync(
        "INSERT INTO products (id, name, barcode, costPrice, sellingPrice, stockQty, unit, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
          String(product.id ?? Date.now()),
          String(product.name ?? "Unnamed product"),
          product.barcode ?? null,
          toNumber(product.costPrice),
          toNumber(product.sellingPrice),
          toInteger(product.stockQty),
          String(product.unit ?? "unit"),
          toInteger(product.updatedAt, Date.now()),
        ],
      );
    }

    for (const sale of sales) {
      db.runSync(
        "INSERT INTO sales (id, items, totalAmount, paymentMethod, customerName, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
        [
          String(sale.id ?? Date.now()),
          JSON.stringify(
            (sale.items ?? []).map((item) => ({
              ...item,
              costPrice:
                typeof item.costPrice === "number" ? item.costPrice : undefined,
            })),
          ),
          toNumber(sale.totalAmount),
          String(sale.paymentMethod ?? "CASH"),
          sale.customerName ?? null,
          toInteger(sale.createdAt, Date.now()),
        ],
      );
    }

    for (const cashUp of cashUps) {
      db.runSync(
        "INSERT INTO cashups (id, date, expectedCash, actualCash, variance, notes, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          String(cashUp.id ?? Date.now()),
          String(cashUp.date ?? ""),
          toNumber(cashUp.expectedCash),
          toNumber(cashUp.actualCash),
          toNumber(cashUp.variance),
          cashUp.notes ?? null,
          toInteger(cashUp.createdAt, Date.now()),
        ],
      );
    }

    for (const payment of payments) {
      db.runSync(
        "INSERT INTO payments (id, customerName, amount, note, createdAt) VALUES (?, ?, ?, ?, ?)",
        [
          String(payment.id ?? Date.now()),
          String(payment.customerName ?? ""),
          toNumber(payment.amount),
          payment.note ?? null,
          toInteger(payment.createdAt, Date.now()),
        ],
      );
    }

    for (const event of copilotEvents ?? []) {
      db.runSync(
        "INSERT INTO copilot_events (id, rawText, actionType, summary, createdAt) VALUES (?, ?, ?, ?, ?)",
        [
          String(event.id ?? Date.now()),
          String(event.rawText ?? ""),
          String(event.actionType ?? "NOTE"),
          String(event.summary ?? ""),
          toInteger(event.createdAt, Date.now()),
        ],
      );
    }

    for (const [key, value] of Object.entries(settings)) {
      db.runSync("INSERT INTO settings (key, value) VALUES (?, ?)", [key, String(value)]);
    }
  });

  return products.length;
}

export async function exportBackupToFile(): Promise<string> {
  const payload = buildBackupPayload();
  const fileName = `spazastock-backup-${payload.exportedAt.slice(0, 10)}.json`;
  const file = new File(Paths.cache, fileName);
  file.write(JSON.stringify(payload, null, 2));

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing is not available on this device.");
  }

  await Sharing.shareAsync(file.uri, {
    mimeType: "application/json",
    dialogTitle: "Save Spaza OS backup",
    UTI: "public.json",
  });

  return file.uri;
}

export async function pickAndRestoreBackup(): Promise<number | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "application/json",
    copyToCacheDirectory: true,
  });

  if (result.canceled || result.assets.length === 0) {
    return null;
  }

  const content = await new File(result.assets[0].uri).text();
  return importBackupPayload(JSON.parse(content));
}
