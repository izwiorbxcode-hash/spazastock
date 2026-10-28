import { PermissionsAndroid, Platform } from "react-native";
import {
  BleManager,
  State,
  type Device,
  type Service,
} from "react-native-ble-plx";

import type { PrinterDevice, Sale } from "@/types";
import { formatDateTime, formatRand } from "@/utils/format";

const SCAN_DURATION_MS = 6000;
const CONNECT_TIMEOUT_MS = 15_000;
const CHUNK_SIZE = 180;
const CHUNK_DELAY_MS = 40;
const RECEIPT_WIDTH = 32;

const PREFERRED_SERVICE_UUIDS = [
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "000018f0-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
];

const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

let manager: BleManager | null = null;

function getManager(): BleManager {
  manager ??= new BleManager();
  return manager;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function requestBluetoothPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;

  if (typeof Platform.Version === "number" && Platform.Version >= 31) {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    return Object.values(result).every(
      (value) => value === PermissionsAndroid.RESULTS.GRANTED,
    );
  }

  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export async function scanForPrinters(
  onDeviceFound: (device: PrinterDevice) => void,
  onError?: (message: string) => void,
): Promise<() => void> {
  const granted = await requestBluetoothPermissions();
  if (!granted) {
    onError?.("Bluetooth permission is required to find thermal printers.");
    return () => undefined;
  }

  const bleManager = getManager();
  const state = await bleManager.state();
  if (state !== State.PoweredOn) {
    onError?.("Please turn on Bluetooth to find your thermal printer.");
    return () => undefined;
  }

  const stopScan = () => {
    bleManager.stopDeviceScan();
  };

  bleManager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
    if (error) {
      onError?.(error.message);
      return;
    }
    if (device?.name) {
      onDeviceFound({ id: device.id, name: device.name });
    }
  });

  const timer = setTimeout(stopScan, SCAN_DURATION_MS);
  return () => {
    clearTimeout(timer);
    stopScan();
  };
}

async function findWritableCharacteristic(device: Device): Promise<{
  serviceUUID: string;
  characteristicUUID: string;
  withoutResponse: boolean;
}> {
  const services = await device.services();
  const ranked = [...services].sort(
    (a: Service, b: Service) =>
      Number(PREFERRED_SERVICE_UUIDS.includes(b.uuid.toLowerCase())) -
      Number(PREFERRED_SERVICE_UUIDS.includes(a.uuid.toLowerCase())),
  );

  for (const service of ranked) {
    const characteristics = await service.characteristics();
    for (const characteristic of characteristics) {
      if (characteristic.isWritableWithoutResponse) {
        return {
          serviceUUID: service.uuid,
          characteristicUUID: characteristic.uuid,
          withoutResponse: true,
        };
      }
      if (characteristic.isWritableWithResponse) {
        return {
          serviceUUID: service.uuid,
          characteristicUUID: characteristic.uuid,
          withoutResponse: false,
        };
      }
    }
  }

  throw new Error("This device does not look like a Bluetooth receipt printer.");
}

function base64Encode(bytes: Uint8Array): string {
  let result = "";

  for (let i = 0; i < bytes.length; i += 3) {
    const byteA = bytes[i] ?? 0;
    const byteB = i + 1 < bytes.length ? (bytes[i + 1] ?? 0) : 0;
    const byteC = i + 2 < bytes.length ? (bytes[i + 2] ?? 0) : 0;
    const triplet = (byteA << 16) | (byteB << 8) | byteC;

    result += BASE64_CHARS.charAt((triplet >> 18) & 63);
    result += BASE64_CHARS.charAt((triplet >> 12) & 63);
    result +=
      i + 1 < bytes.length ? BASE64_CHARS.charAt((triplet >> 6) & 63) : "=";
    result += i + 2 < bytes.length ? BASE64_CHARS.charAt(triplet & 63) : "=";
  }

  return result;
}

function buildReceiptBytes(sale: Sale, shopName: string): Uint8Array {
  const bytes: number[] = [];

  const push = (...values: number[]) => {
    bytes.push(...values);
  };
  const ascii = (text: string) => {
    for (const char of text) {
      const code = char.charCodeAt(0);
      push(code < 256 ? code : 0x3f);
    }
  };
  const line = (text = "") => {
    ascii(`${text}\n`);
  };
  const divider = () => {
    line("-".repeat(RECEIPT_WIDTH));
  };
  const row = (left: string, right: string) => {
    const space = Math.max(1, RECEIPT_WIDTH - left.length - right.length);
    line(left + " ".repeat(space) + right);
  };

  push(0x1b, 0x40);
  push(0x1b, 0x61, 0x01);
  push(0x1b, 0x45, 0x01);
  line(shopName);
  push(0x1b, 0x45, 0x00);
  line(formatDateTime(sale.createdAt));
  push(0x1b, 0x61, 0x00);
  divider();
  line(`Receipt: ${sale.id}`);
  line(
    `Payment: ${sale.paymentMethod}${sale.customerName ? ` - ${sale.customerName}` : ""}`,
  );
  divider();

  for (const item of sale.items) {
    line(item.productName);
    row(`  ${item.quantity} x ${formatRand(item.unitPrice)}`, formatRand(item.total));
  }

  divider();
  push(0x1b, 0x45, 0x01);
  row("TOTAL", formatRand(sale.totalAmount));
  push(0x1b, 0x45, 0x00);
  divider();
  push(0x1b, 0x61, 0x01);
  line("Thank you for your support!");
  line("");
  line("");
  push(0x1d, 0x56, 0x41, 0x10);

  return Uint8Array.from(bytes);
}

export async function printReceipt(
  deviceId: string,
  sale: Sale,
  shopName = "SPAZASTOCK",
): Promise<void> {
  const bleManager = getManager();
  const device = await bleManager.connectToDevice(deviceId, {
    timeout: CONNECT_TIMEOUT_MS,
  });

  try {
    await device.discoverAllServicesAndCharacteristics();
    const target = await findWritableCharacteristic(device);
    const encoded = base64Encode(buildReceiptBytes(sale, shopName));

    for (let start = 0; start < encoded.length; start += CHUNK_SIZE) {
      const chunk = encoded.slice(start, start + CHUNK_SIZE);
      if (target.withoutResponse) {
        await device.writeCharacteristicWithoutResponseForService(
          target.serviceUUID,
          target.characteristicUUID,
          chunk,
        );
      } else {
        await device.writeCharacteristicWithResponseForService(
          target.serviceUUID,
          target.characteristicUUID,
          chunk,
        );
      }
      await delay(CHUNK_DELAY_MS);
    }
  } finally {
    await device.cancelConnection().catch(() => undefined);
  }
}
