import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import {
  Button,
  Chip,
  Dialog,
  Input,
  Label,
  SearchField,
  TextField,
  useThemeColor,
} from "heroui-native";
import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import db, { getLowStockThreshold, DEFAULT_LOW_STOCK_THRESHOLD } from "@/database/db";
import type { Product } from "@/types";
import { formatRand } from "@/utils/format";

type StockFilter = "ALL" | "LOW";

const EMPTY_FORM = {
  name: "",
  barcode: "",
  costPrice: "",
  sellingPrice: "",
  stockQty: "",
  unit: "unit",
};

export default function InventoryScreen() {
  const themeColorAccentForeground = useThemeColor("accent-foreground");
  const themeColorDanger = useThemeColor("danger");

  const [products, setProducts] = useState<Product[]>([]);
  const [threshold, setThreshold] = useState(DEFAULT_LOW_STOCK_THRESHOLD);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StockFilter>("ALL");

  const [dialogVisible, setDialogVisible] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const loadInventory = useCallback(
    (searchTerm: string, activeFilter: StockFilter, lowThreshold: number) => {
      const params: (string | number)[] = [`%${searchTerm}%`, `%${searchTerm}%`];
      let query = "SELECT * FROM products WHERE (name LIKE ? OR barcode LIKE ?)";

      if (activeFilter === "LOW") {
        query += " AND stockQty <= ?";
        params.push(lowThreshold);
      }

      query += " ORDER BY stockQty ASC, name ASC";
      setProducts(db.getAllSync<Product>(query, params));
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      const lowThreshold = getLowStockThreshold();
      setThreshold(lowThreshold);
      loadInventory(search, filter, lowThreshold);
    }, [filter, loadInventory, search]),
  );

  const refresh = useCallback(() => {
    const lowThreshold = getLowStockThreshold();
    setThreshold(lowThreshold);
    loadInventory(search, filter, lowThreshold);
  }, [filter, loadInventory, search]);

  const openAddDialog = useCallback(() => {
    setEditingProduct(null);
    setForm(EMPTY_FORM);
    setDialogVisible(true);
  }, []);

  const openEditDialog = useCallback((product: Product) => {
    setEditingProduct(product);
    setForm({
      name: product.name,
      barcode: product.barcode ?? "",
      costPrice: String(product.costPrice),
      sellingPrice: String(product.sellingPrice),
      stockQty: String(product.stockQty),
      unit: product.unit,
    });
    setDialogVisible(true);
  }, []);

  const saveProduct = useCallback(() => {
    const name = form.name.trim();
    const sellingPrice = Number.parseFloat(form.sellingPrice);
    const stockQty = Number.parseInt(form.stockQty, 10);

    if (!name || !Number.isFinite(sellingPrice) || !Number.isFinite(stockQty)) {
      Alert.alert(
        "Missing details",
        "Please fill in the product name, selling price, and stock quantity.",
      );
      return;
    }

    const costPrice = Number.parseFloat(form.costPrice);
    const unit = form.unit.trim() || "unit";
    const barcode = form.barcode.trim() || null;
    const updatedAt = Date.now();

    try {
      if (editingProduct) {
        db.runSync(
          "UPDATE products SET name = ?, barcode = ?, costPrice = ?, sellingPrice = ?, stockQty = ?, unit = ?, updatedAt = ? WHERE id = ?",
          [
            name,
            barcode,
            Number.isFinite(costPrice) ? costPrice : 0,
            sellingPrice,
            stockQty,
            unit,
            updatedAt,
            editingProduct.id,
          ],
        );
      } else {
        db.runSync(
          "INSERT INTO products (id, name, barcode, costPrice, sellingPrice, stockQty, unit, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [
            `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            name,
            barcode,
            Number.isFinite(costPrice) ? costPrice : 0,
            sellingPrice,
            stockQty,
            unit,
            updatedAt,
          ],
        );
      }
      setDialogVisible(false);
      refresh();
    } catch (error) {
      Alert.alert(
        "Could not save",
        error instanceof Error && error.message.includes("UNIQUE")
          ? "Another product already uses this barcode."
          : "Something went wrong while saving the product.",
      );
    }
  }, [editingProduct, form, refresh]);

  const deleteProduct = useCallback(
    (product: Product) => {
      Alert.alert(
        "Delete product",
        `Remove ${product.name} from your stock list? Past sales reports stay intact.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              db.runSync("DELETE FROM products WHERE id = ?", [product.id]);
              refresh();
            },
          },
        ],
      );
    },
    [refresh],
  );

  return (
    <Container isScrollable={false} className="px-4 pt-3">
      <View className="mb-3 flex-row items-center gap-2">
        <View className="flex-1">
          <SearchField value={search} onChange={setSearch}>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search products or barcodes" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
        </View>
        <Button isIconOnly accessibilityLabel="Add product" onPress={openAddDialog}>
          <Ionicons name="add" size={24} color={themeColorAccentForeground} />
        </Button>
      </View>

      <View className="mb-3 flex-row gap-2">
        <Button
          className="flex-1"
          size="sm"
          variant={filter === "ALL" ? "primary" : "secondary"}
          onPress={() => setFilter("ALL")}
        >
          <Button.Label>All items</Button.Label>
        </Button>
        <Button
          className="flex-1"
          size="sm"
          variant={filter === "LOW" ? "danger" : "secondary"}
          onPress={() => setFilter("LOW")}
        >
          <Button.Label>Low stock</Button.Label>
        </Button>
      </View>

      <FlatList
        data={products}
        keyExtractor={(item) => item.id}
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        ListEmptyComponent={
          <Text className="mt-10 text-center text-sm text-muted">
            {filter === "LOW"
              ? "No low stock products. Your shelves are healthy."
              : "No products yet. Tap + to add your first item."}
          </Text>
        }
        renderItem={({ item }) => {
          const isLow = item.stockQty <= threshold;
          return (
            <View className="mb-2 flex-row items-center justify-between rounded-xl bg-surface p-4">
              <Pressable className="flex-1 pr-3" onPress={() => openEditDialog(item)}>
                <View className="flex-row items-center gap-2">
                  <Text className="font-semibold text-foreground">{item.name}</Text>
                  {isLow ? (
                    <Chip size="sm" variant="soft" color="danger">
                      <Chip.Label>Low stock</Chip.Label>
                    </Chip>
                  ) : null}
                </View>
                <Text className="mt-1 text-xs text-muted">
                  Stock:{" "}
                  <Text className={isLow ? "text-danger" : "text-foreground"}>
                    {item.stockQty} {item.unit}
                  </Text>{" "}
                  | Cost: {formatRand(item.costPrice)}
                </Text>
              </Pressable>
              <View className="items-end gap-2">
                <Text className="font-semibold text-foreground">
                  {formatRand(item.sellingPrice)}
                </Text>
                <Pressable
                  accessibilityLabel={`Delete ${item.name}`}
                  onPress={() => deleteProduct(item)}
                  className="active:opacity-60"
                >
                  <Ionicons name="trash-outline" size={18} color={themeColorDanger} />
                </Pressable>
              </View>
            </View>
          );
        }}
      />

      <Dialog
        isOpen={dialogVisible}
        onOpenChange={(open) => {
          if (!open) setDialogVisible(false);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content>
            <Dialog.Title>{editingProduct ? "Edit product" : "Add product"}</Dialog.Title>
            <Dialog.Description>
              Prices are per {form.unit.trim() || "unit"} in Rand.
            </Dialog.Description>

            <View className="mt-4 gap-3">
              <TextField>
                <Label>Product name</Label>
                <Input
                  placeholder="e.g. 2L Coca-Cola"
                  value={form.name}
                  onChangeText={(value) => setForm((prev) => ({ ...prev, name: value }))}
                />
              </TextField>

              <TextField>
                <Label>Barcode / SKU (optional)</Label>
                <Input
                  placeholder="Scan or type barcode"
                  value={form.barcode}
                  onChangeText={(value) => setForm((prev) => ({ ...prev, barcode: value }))}
                />
              </TextField>

              <View className="flex-row gap-3">
                <TextField className="flex-1">
                  <Label>Cost price</Label>
                  <Input
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                    value={form.costPrice}
                    onChangeText={(value) => setForm((prev) => ({ ...prev, costPrice: value }))}
                  />
                </TextField>
                <TextField className="flex-1">
                  <Label>Selling price</Label>
                  <Input
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                    value={form.sellingPrice}
                    onChangeText={(value) => setForm((prev) => ({ ...prev, sellingPrice: value }))}
                  />
                </TextField>
              </View>

              <View className="flex-row gap-3">
                <TextField className="flex-1">
                  <Label>Stock quantity</Label>
                  <Input
                    placeholder="0"
                    keyboardType="number-pad"
                    value={form.stockQty}
                    onChangeText={(value) => setForm((prev) => ({ ...prev, stockQty: value }))}
                  />
                </TextField>
                <TextField className="flex-1">
                  <Label>Unit</Label>
                  <Input
                    placeholder="unit, kg, crate"
                    value={form.unit}
                    onChangeText={(value) => setForm((prev) => ({ ...prev, unit: value }))}
                  />
                </TextField>
              </View>
            </View>

            <Button className="mt-5" onPress={saveProduct}>
              <Button.Label>{editingProduct ? "Save changes" : "Add product"}</Button.Label>
            </Button>
            <Button
              className="mt-2"
              variant="secondary"
              onPress={() => setDialogVisible(false)}
            >
              <Button.Label>Cancel</Button.Label>
            </Button>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </Container>
  );
}
