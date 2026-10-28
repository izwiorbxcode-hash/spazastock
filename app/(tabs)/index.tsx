import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useFocusEffect } from "expo-router";
import {
  Button,
  Dialog,
  Input,
  SearchField,
  Separator,
  Spinner,
  TextField,
  useThemeColor,
} from "heroui-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { Container } from "@/components/container";
import db, { getLowStockThreshold, DEFAULT_LOW_STOCK_THRESHOLD } from "@/database/db";
import type { PrinterDevice, Product, Sale, SaleItem } from "@/types";
import { formatRand } from "@/utils/format";
import { printReceipt, scanForPrinters } from "@/utils/printer";

type PaymentChoice = "CASH" | "TICK";

const SCAN_TIMEOUT_MS = 6000;

export default function PosScreen() {
  const themeColorAccentForeground = useThemeColor("accent-foreground");
  const themeColorDangerForeground = useThemeColor("danger-foreground");

  const [products, setProducts] = useState<Product[]>([]);
  const [threshold, setThreshold] = useState(DEFAULT_LOW_STOCK_THRESHOLD);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice>("CASH");
  const [customerName, setCustomerName] = useState("");

  const [scannerVisible, setScannerVisible] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const [pendingSale, setPendingSale] = useState<Sale | null>(null);
  const [printerDialogVisible, setPrinterDialogVisible] = useState(false);
  const [printers, setPrinters] = useState<PrinterDevice[]>([]);
  const [scanningPrinters, setScanningPrinters] = useState(false);
  const [printerError, setPrinterError] = useState<string | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);

  const stopScanRef = useRef<(() => void) | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadProducts = useCallback(() => {
    const rows = db.getAllSync<Product>(
      "SELECT * FROM products WHERE name LIKE ? OR barcode LIKE ? ORDER BY name ASC",
      [`%${search}%`, `%${search}%`],
    );
    setProducts(rows);
  }, [search]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useFocusEffect(
    useCallback(() => {
      setThreshold(getLowStockThreshold());
      loadProducts();
    }, [loadProducts]),
  );

  useEffect(
    () => () => {
      stopScanRef.current?.();
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    },
    [],
  );

  const cartTotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.total, 0),
    [cart],
  );

  const addToCart = useCallback(
    (product: Product) => {
      const existing = cart.find((item) => item.productId === product.id);
      const currentQuantity = existing?.quantity ?? 0;

      if (product.stockQty <= 0) {
        Alert.alert("Out of stock", `${product.name} has no stock left.`);
        return;
      }
      if (currentQuantity >= product.stockQty) {
        Alert.alert("Stock limit", `Only ${product.stockQty} ${product.unit} of ${product.name} available.`);
        return;
      }

      if (existing) {
        setCart((prev) =>
          prev.map((item) =>
            item.productId === product.id
              ? {
                  ...item,
                  quantity: item.quantity + 1,
                  total: (item.quantity + 1) * item.unitPrice,
                }
              : item,
          ),
        );
      } else {
        setCart((prev) => [
          ...prev,
          {
            productId: product.id,
            productName: product.name,
            quantity: 1,
            unitPrice: product.sellingPrice,
            costPrice: product.costPrice,
            total: product.sellingPrice,
          },
        ]);
      }
    },
    [cart],
  );

  const changeQuantity = useCallback(
    (item: SaleItem, delta: number) => {
      const nextQuantity = item.quantity + delta;

      if (nextQuantity <= 0) {
        setCart((prev) => prev.filter((cartItem) => cartItem.productId !== item.productId));
        return;
      }

      const product = products.find((entry) => entry.id === item.productId);
      if (product && nextQuantity > product.stockQty) {
        Alert.alert("Stock limit", `Only ${product.stockQty} ${product.unit} available.`);
        return;
      }

      setCart((prev) =>
        prev.map((cartItem) =>
          cartItem.productId === item.productId
            ? { ...cartItem, quantity: nextQuantity, total: nextQuantity * cartItem.unitPrice }
            : cartItem,
        ),
      );
    },
    [products],
  );

  const openScanner = useCallback(async () => {
    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();
      if (!permission.granted) {
        Alert.alert("Camera permission needed", "Allow camera access to scan product barcodes.");
        return;
      }
    }
    setScanned(false);
    setScannerVisible(true);
  }, [cameraPermission, requestCameraPermission]);

  const handleBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      if (scanned) return;
      setScanned(true);
      setScannerVisible(false);

      const matches = db.getAllSync<Product>("SELECT * FROM products WHERE barcode = ?", [data]);
      const match = matches[0];

      if (match) {
        addToCart(match);
      } else {
        Alert.alert("Product not found", `No product matches barcode ${data}. Add it from the Stock tab first.`);
      }

      setTimeout(() => setScanned(false), 1500);
    },
    [addToCart, scanned],
  );

  const closePrinterDialog = useCallback(() => {
    stopScanRef.current?.();
    stopScanRef.current = null;
    if (scanTimerRef.current) {
      clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    setPrinterDialogVisible(false);
    setScanningPrinters(false);
    setPendingSale(null);
  }, []);

  const openPrinterDialog = useCallback((sale: Sale) => {
    setPendingSale(sale);
    setPrinters([]);
    setPrinterError(null);
    setScanningPrinters(true);
    setPrinterDialogVisible(true);

    scanTimerRef.current = setTimeout(() => setScanningPrinters(false), SCAN_TIMEOUT_MS);
    void scanForPrinters(
      (device) =>
        setPrinters((prev) =>
          prev.some((entry) => entry.id === device.id) ? prev : [...prev, device],
        ),
      (message) => {
        setPrinterError(message);
        setScanningPrinters(false);
      },
    ).then((stop) => {
      stopScanRef.current = stop;
    });
  }, []);

  const handleSelectPrinter = useCallback(
    async (device: PrinterDevice) => {
      if (!pendingSale || isPrinting) return;
      setIsPrinting(true);
      try {
        await printReceipt(device.id, pendingSale);
        closePrinterDialog();
        Alert.alert("Receipt printed", "The sale is saved and the slip was sent to the printer.");
      } catch (error) {
        Alert.alert(
          "Print failed",
          error instanceof Error ? error.message : "Could not print the receipt.",
        );
      } finally {
        setIsPrinting(false);
      }
    },
    [closePrinterDialog, isPrinting, pendingSale],
  );

  const checkout = useCallback(() => {
    if (cart.length === 0) return;

    const trimmedCustomer = customerName.trim();
    if (paymentChoice === "TICK" && !trimmedCustomer) {
      Alert.alert("Customer needed", "Enter a customer name or phone number for a tick (credit) sale.");
      return;
    }

    const sale: Sale = {
      id: `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      items: cart,
      totalAmount: cartTotal,
      paymentMethod: paymentChoice,
      customerName: paymentChoice === "TICK" ? trimmedCustomer : null,
      createdAt: Date.now(),
    };

    try {
      db.withTransactionSync(() => {
        db.runSync(
          "INSERT INTO sales (id, items, totalAmount, paymentMethod, customerName, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
          [
            sale.id,
            JSON.stringify(sale.items),
            sale.totalAmount,
            sale.paymentMethod,
            sale.customerName,
            sale.createdAt,
          ],
        );
        for (const item of sale.items) {
          db.runSync(
            "UPDATE products SET stockQty = MAX(stockQty - ?, 0), updatedAt = ? WHERE id = ?",
            [item.quantity, sale.createdAt, item.productId],
          );
        }
      });
    } catch {
      Alert.alert("Sale not saved", "Something went wrong while saving the sale. Please try again.");
      return;
    }

    setCart([]);
    setCustomerName("");
    setPaymentChoice("CASH");
    loadProducts();
    openPrinterDialog(sale);
  }, [cart, cartTotal, customerName, loadProducts, openPrinterDialog, paymentChoice]);

  return (
    <Container isScrollable={false} className="px-4 pt-3">
      <View className="mb-3 flex-row items-center gap-2">
        <View className="flex-1">
          <SearchField value={search} onChange={setSearch}>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search products" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
        </View>
        <Button
          isIconOnly
          accessibilityLabel="Scan a product barcode"
          onPress={() => void openScanner()}
        >
          <Ionicons name="barcode-outline" size={22} color={themeColorAccentForeground} />
        </Button>
      </View>

      <FlatList
        data={products}
        keyExtractor={(item) => item.id}
        className="flex-1"
        contentContainerStyle={{ paddingBottom: cart.length > 0 ? 12 : 32 }}
        ListEmptyComponent={
          <Text className="mt-10 text-center text-sm text-muted">
            No products found. Add your stock from the Stock tab.
          </Text>
        }
        renderItem={({ item }) => {
          const isLow = item.stockQty <= threshold;
          return (
            <Pressable
              onPress={() => addToCart(item)}
              className="mb-2 flex-row items-center justify-between rounded-xl bg-surface p-4 active:opacity-70"
            >
              <View className="flex-1 pr-3">
                <Text className="font-semibold text-foreground">{item.name}</Text>
                <Text className={`mt-1 text-xs ${isLow ? "text-danger" : "text-muted"}`}>
                  {item.stockQty <= 0
                    ? "Out of stock"
                    : `In stock: ${item.stockQty} ${item.unit}`}
                </Text>
              </View>
              <Text className="font-semibold text-foreground">
                {formatRand(item.sellingPrice)}
              </Text>
            </Pressable>
          );
        }}
      />

      {cart.length > 0 ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="mb-2"
        >
          <View className="rounded-2xl border border-border bg-surface p-3">
            <ScrollView style={{ maxHeight: 140 }}>
              {cart.map((item) => (
                <View
                  key={item.productId}
                  className="flex-row items-center justify-between py-1"
                >
                  <View className="flex-1 pr-2">
                    <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                      {item.productName}
                    </Text>
                    <Text className="text-xs text-muted">
                      {formatRand(item.unitPrice)} each
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-2">
                    <Pressable
                      onPress={() => changeQuantity(item, -1)}
                      className="h-8 w-8 items-center justify-center rounded-lg bg-surface-secondary active:opacity-70"
                    >
                      <Ionicons name="remove" size={16} />
                    </Pressable>
                    <Text className="w-6 text-center font-semibold text-foreground">
                      {item.quantity}
                    </Text>
                    <Pressable
                      onPress={() => changeQuantity(item, 1)}
                      className="h-8 w-8 items-center justify-center rounded-lg bg-surface-secondary active:opacity-70"
                    >
                      <Ionicons name="add" size={16} />
                    </Pressable>
                  </View>
                  <Text className="w-20 text-right font-semibold text-foreground">
                    {formatRand(item.total)}
                  </Text>
                </View>
              ))}
            </ScrollView>

            <Separator className="my-2" />

            <View className="mb-2 flex-row items-center justify-between">
              <Text className="font-semibold text-foreground">Total</Text>
              <Text className="text-lg font-bold text-foreground">
                {formatRand(cartTotal)}
              </Text>
            </View>

            <View className="mb-2 flex-row gap-2">
              <Button
                className="flex-1"
                variant={paymentChoice === "CASH" ? "primary" : "secondary"}
                onPress={() => setPaymentChoice("CASH")}
              >
                <Button.Label>Cash</Button.Label>
              </Button>
              <Button
                className="flex-1"
                variant={paymentChoice === "TICK" ? "primary" : "secondary"}
                onPress={() => setPaymentChoice("TICK")}
              >
                <Button.Label>On tick</Button.Label>
              </Button>
            </View>

            {paymentChoice === "TICK" ? (
              <TextField className="mb-2">
                <Input
                  placeholder="Customer name or phone"
                  value={customerName}
                  onChangeText={setCustomerName}
                />
              </TextField>
            ) : null}

            <Button onPress={checkout}>
              <Ionicons name="print-outline" size={18} color={themeColorAccentForeground} />
              <Button.Label>Complete sale & print</Button.Label>
            </Button>
          </View>
        </KeyboardAvoidingView>
      ) : null}

      <Modal
        visible={scannerVisible}
        animationType="slide"
        onRequestClose={() => setScannerVisible(false)}
      >
        <View className="flex-1 bg-black">
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{
              barcodeTypes: [
                "qr",
                "ean13",
                "ean8",
                "upc_a",
                "upc_e",
                "code128",
                "code39",
                "itf14",
              ],
            }}
            onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
          />
          <View className="absolute inset-x-0 bottom-0 items-center bg-black/70 p-6">
            <Text className="mb-4 text-center text-white">
              Point the camera at a product barcode
            </Text>
            <Button variant="danger" onPress={() => setScannerVisible(false)}>
              <Ionicons name="close" size={18} color={themeColorDangerForeground} />
              <Button.Label>Cancel scanning</Button.Label>
            </Button>
          </View>
        </View>
      </Modal>

      <Dialog
        isOpen={printerDialogVisible}
        onOpenChange={(open) => {
          if (!open) closePrinterDialog();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content>
            <Dialog.Title>Print receipt?</Dialog.Title>
            <Dialog.Description>
              Sale saved. Pick your Bluetooth printer to print the slip, or skip.
            </Dialog.Description>

            <View className="mt-4">
              {scanningPrinters ? (
                <View className="mb-3 flex-row items-center gap-2">
                  <Spinner size="sm" />
                  <Text className="text-sm text-muted">Searching for printers...</Text>
                </View>
              ) : null}

              {printerError ? (
                <Text className="mb-3 text-sm text-danger">{printerError}</Text>
              ) : null}

              <ScrollView style={{ maxHeight: 220 }}>
                {printers.map((device) => (
                  <Pressable
                    key={device.id}
                    disabled={isPrinting}
                    onPress={() => void handleSelectPrinter(device)}
                    className="mb-2 rounded-xl bg-surface-secondary p-3 active:opacity-70"
                  >
                    <Text className="font-medium text-foreground">{device.name}</Text>
                    <Text className="text-xs text-muted">{device.id}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              {!scanningPrinters && printers.length === 0 && !printerError ? (
                <Text className="text-sm text-muted">
                  No printers found. Switch the printer on and try again.
                </Text>
              ) : null}

              {isPrinting ? (
                <View className="mt-3 flex-row items-center gap-2">
                  <Spinner size="sm" />
                  <Text className="text-sm text-muted">Sending receipt...</Text>
                </View>
              ) : null}
            </View>

            <Button
              className="mt-4"
              variant="secondary"
              isDisabled={isPrinting}
              onPress={closePrinterDialog}
            >
              <Button.Label>Skip printing</Button.Label>
            </Button>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </Container>
  );
}
