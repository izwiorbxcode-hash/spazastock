export type PaymentMethod = "CASH" | "TICK" | "TRANSFER";

export interface Product {
  id: string;
  name: string;
  barcode: string | null;
  costPrice: number;
  sellingPrice: number;
  stockQty: number;
  unit: string;
  updatedAt: number;
}

export interface SaleItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  costPrice?: number;
  total: number;
}

export interface Sale {
  id: string;
  items: SaleItem[];
  totalAmount: number;
  paymentMethod: PaymentMethod;
  customerName: string | null;
  createdAt: number;
}

export interface CashUpRecord {
  id: string;
  date: string;
  expectedCash: number;
  actualCash: number;
  variance: number;
  notes: string | null;
  createdAt: number;
}

export interface CreditPayment {
  id: string;
  customerName: string;
  amount: number;
  note: string | null;
  createdAt: number;
}

export interface CopilotEvent {
  id: string;
  rawText: string;
  actionType: "STOCK" | "CREDIT" | "PAYMENT" | "NOTE";
  summary: string;
  createdAt: number;
}

export interface BackupData {
  products: Product[];
  sales: Sale[];
  cashUps: CashUpRecord[];
  payments: CreditPayment[];
  copilotEvents?: CopilotEvent[];
  settings: Record<string, string>;
}

export interface BackupPayload {
  version: number;
  app: string;
  exportedAt: string;
  data: BackupData;
}

export interface PrinterDevice {
  id: string;
  name: string;
}
