import db from "@/database/db";
import type { CopilotEvent, Product, SaleItem } from "@/types";

export type CopilotPlan =
  | { actionType: "PAYMENT"; summary: string; customerName: string; amount: number }
  | { actionType: "CREDIT"; summary: string; customerName: string; amount: number; description: string }
  | { actionType: "STOCK"; summary: string; product: Product; nextStock: number }
  | { actionType: "NOTE"; summary: string };

const QUANTITY = /(?:add|received|got|delivered|stocked|there are|is|faka|engeza|kukhona|voeg by|bygevoeg)\s+(\d+)\s+(.+)/i;

function eventId() {
  return `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function findProduct(words: string): Product | null {
  const cleaned = words
    .replace(/\b(left|in stock|stock|units?|items?|please|today|ekhona|amashefu|voorraad)\b/gi, "")
    .trim();
  if (!cleaned) return null;
  return db.getFirstSync<Product>(
    "SELECT * FROM products WHERE lower(name) LIKE ? ORDER BY length(name) ASC LIMIT 1",
    [`%${cleaned.toLowerCase()}%`],
  ) ?? null;
}

/** Parses a short spoken-style message without touching data. */
export function previewCopilotNote(input: string): CopilotPlan {
  const rawText = input.trim();
  const normalized = rawText.toLowerCase();
  if (!rawText) throw new Error("Say or type a short note first.");

  const namedPayment = normalized.match(/^(.+?)\s+(?:paid|payed|settled|gave|ukhokhe|betaal)\s+(?:me\s+)?(?:r|zar)\s*(\d+(?:[.,]\d{1,2})?)(?:\s+today)?$/i);
  const receivedPayment = normalized.match(/^(?:received|got)\s+(?:r|zar)\s*(\d+(?:[.,]\d{1,2})?)\s+(?:from\s+)?(.+?)(?:\s+today)?$/i);
  const paymentMatch = namedPayment ?? receivedPayment;
  if (paymentMatch) {
    const amount = Number.parseFloat((namedPayment ? paymentMatch[2] : paymentMatch[1]).replace(",", "."));
    const customerName = (namedPayment ? paymentMatch[1] : paymentMatch[2]).replace(/\b(today|just now)\b/gi, "").trim();
    if (!customerName || !Number.isFinite(amount) || amount <= 0) throw new Error("I need a customer name and a Rand amount for that payment.");
    return { actionType: "PAYMENT", customerName, amount, summary: `Record R${amount.toFixed(2)} paid by ${customerName}.` };
  }

  const debtMatch = normalized.match(/(.+?)\s+(?:owes|owe|on tick for|ukweleta|skuld)\s+(?:r|zar)\s*(\d+(?:[.,]\d{1,2})?)(?:\s+(?:for|nge|vir)\s+(.+))?$/i);
  if (debtMatch) {
    const customerName = debtMatch[1].trim();
    const amount = Number.parseFloat(debtMatch[2].replace(",", "."));
    const description = debtMatch[3]?.trim() || "Items on tick";
    if (!customerName || !Number.isFinite(amount) || amount <= 0) throw new Error("I need a customer name and a Rand amount for that credit note.");
    return { actionType: "CREDIT", customerName, amount, description, summary: `Add R${amount.toFixed(2)} to ${customerName}'s book for ${description}.` };
  }

  const quantityMatch = normalized.match(QUANTITY);
  if (quantityMatch) {
    const quantity = Number.parseInt(quantityMatch[1], 10);
    const product = findProduct(quantityMatch[2]);
    if (product && Number.isFinite(quantity)) {
      const setStock = /(?:there are|is|kukhona)\s+\d+/i.test(normalized) || /\b(left|ekhona)\b/i.test(normalized);
      const nextStock = setStock ? quantity : product.stockQty + quantity;
      return { actionType: "STOCK", product, nextStock, summary: `${product.name}: ${setStock ? "set" : "add"} stock to ${nextStock} ${product.unit}.` };
    }
  }

  return { actionType: "NOTE", summary: "Save this as a private local note. Add the product to Stock first if you want me to update a count." };
}

/** Commits an already-reviewed plan in one local SQLite transaction. */
export function commitCopilotPlan(rawText: string, plan: CopilotPlan): CopilotEvent["actionType"] {
  db.withTransactionSync(() => {
    if (plan.actionType === "PAYMENT") {
      db.runSync("INSERT INTO payments (id, customerName, amount, note, createdAt) VALUES (?, ?, ?, ?, ?)", [eventId(), plan.customerName, plan.amount, "Added with Spaza OS", Date.now()]);
    } else if (plan.actionType === "CREDIT") {
      const item: SaleItem = { productId: "copilot-credit", productName: plan.description, quantity: 1, unitPrice: plan.amount, total: plan.amount };
      db.runSync("INSERT INTO sales (id, items, totalAmount, paymentMethod, customerName, createdAt) VALUES (?, ?, ?, ?, ?, ?)", [eventId(), JSON.stringify([item]), plan.amount, "TICK", plan.customerName, Date.now()]);
    } else if (plan.actionType === "STOCK") {
      db.runSync("UPDATE products SET stockQty = ?, updatedAt = ? WHERE id = ?", [plan.nextStock, Date.now(), plan.product.id]);
    }
    db.runSync("INSERT INTO copilot_events (id, rawText, actionType, summary, createdAt) VALUES (?, ?, ?, ?, ?)", [eventId(), rawText.trim(), plan.actionType, plan.summary, Date.now()]);
  });
  return plan.actionType;
}
