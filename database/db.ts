import * as SQLite from "expo-sqlite";

import type { CashUpRecord, CopilotEvent, CreditPayment, Product, Sale } from "@/types";

export const CURRENT_SCHEMA_VERSION = 3;
export const LOW_STOCK_THRESHOLD_KEY = "lowStockThreshold";
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;
export const LAST_GOOGLE_SYNC_KEY = "googleLastSyncAt";

const db = SQLite.openDatabaseSync("spazastock.db");

function migrateToVersion1() {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      barcode TEXT,
      costPrice REAL NOT NULL DEFAULT 0,
      sellingPrice REAL NOT NULL DEFAULT 0,
      stockQty INTEGER NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'unit',
      updatedAt INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY NOT NULL,
      items TEXT NOT NULL,
      totalAmount REAL NOT NULL,
      paymentMethod TEXT NOT NULL,
      customerName TEXT,
      createdAt INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(createdAt);
    CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customerName);

    CREATE TABLE IF NOT EXISTS cashups (
      id TEXT PRIMARY KEY NOT NULL,
      date TEXT NOT NULL,
      expectedCash REAL NOT NULL,
      actualCash REAL NOT NULL,
      variance REAL NOT NULL,
      notes TEXT,
      createdAt INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cashups_date ON cashups(date);

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY NOT NULL,
      customerName TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      createdAt INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customerName);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    PRAGMA user_version = 1;
  `);
}

function migrateToVersion2() {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS copilot_events (
      id TEXT PRIMARY KEY NOT NULL,
      rawText TEXT NOT NULL,
      actionType TEXT NOT NULL,
      summary TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_copilot_events_created ON copilot_events(createdAt);
    PRAGMA user_version = 2;
  `);
}

function migrateToVersion3() {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS voice_notes (
      id TEXT PRIMARY KEY NOT NULL,
      uri TEXT NOT NULL,
      durationMs INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_voice_notes_created ON voice_notes(createdAt);
    PRAGMA user_version = 3;
  `);
}

export function initDatabase(): void {
  db.execSync("PRAGMA journal_mode = WAL;");

  const versionRow = db.getFirstSync<{ user_version: number }>("PRAGMA user_version;");
  const currentVersion = versionRow?.user_version ?? 0;

  if (currentVersion < 1) {
    migrateToVersion1();
  }

  if (currentVersion < 2) {
    migrateToVersion2();
  }

  if (currentVersion < 3) {
    migrateToVersion3();
  }

  // Chain future migrations here:
  // if (currentVersion < 2) { ...; db.execSync("PRAGMA user_version = 2;"); }
}

export function parseSaleRow(row: Record<string, unknown>): Sale {
  return {
    id: String(row.id),
    items: JSON.parse(String(row.items)),
    totalAmount: Number(row.totalAmount),
    paymentMethod: row.paymentMethod as Sale["paymentMethod"],
    customerName: row.customerName === null ? null : String(row.customerName),
    createdAt: Number(row.createdAt),
  };
}

export function getSetting(key: string): string | null {
  const row = db.getFirstSync<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.runSync(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

export function getLowStockThreshold(): number {
  const raw = getSetting(LOW_STOCK_THRESHOLD_KEY);
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_LOW_STOCK_THRESHOLD;
}

export function getAllProducts(): Product[] {
  return db.getAllSync<Product>("SELECT * FROM products ORDER BY name ASC");
}

export function getAllSales(): Sale[] {
  const rows = db.getAllSync<Record<string, unknown>>("SELECT * FROM sales ORDER BY createdAt DESC");
  return rows.map(parseSaleRow);
}

export function getAllCashUps(): CashUpRecord[] {
  return db.getAllSync<CashUpRecord>("SELECT * FROM cashups ORDER BY createdAt DESC");
}

export function getAllPayments(): CreditPayment[] {
  return db.getAllSync<CreditPayment>("SELECT * FROM payments ORDER BY createdAt DESC");
}

export function getAllCopilotEvents(): CopilotEvent[] {
  return db.getAllSync<CopilotEvent>("SELECT * FROM copilot_events ORDER BY createdAt DESC");
}

export function getAllSettings(): Record<string, string> {
  const rows = db.getAllSync<{ key: string; value: string }>("SELECT * FROM settings");
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

initDatabase();

export default db;
