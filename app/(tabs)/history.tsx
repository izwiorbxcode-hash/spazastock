import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import {
  Button,
  Chip,
  Input,
  Separator,
  TextField,
  useThemeColor,
} from "heroui-native";
import { useCallback, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import db, { parseSaleRow } from "@/database/db";
import type { Sale } from "@/types";
import { formatRand, formatTime, shiftDateKey, todayKey } from "@/utils/format";

interface DailySummary {
  revenue: number;
  profit: number;
  count: number;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export default function HistoryScreen() {
  const themeColorForeground = useThemeColor("foreground");

  const [dateInput, setDateInput] = useState(todayKey());
  const [sales, setSales] = useState<Sale[]>([]);
  const [summary, setSummary] = useState<DailySummary>({ revenue: 0, profit: 0, count: 0 });

  const isValidDate = DATE_PATTERN.test(dateInput);
  const activeDate = isValidDate ? dateInput : todayKey();

  const loadSales = useCallback((dateKey: string) => {
    const rows = db.getAllSync<Record<string, unknown>>(
      "SELECT * FROM sales WHERE date(createdAt / 1000, 'unixepoch', 'localtime') = ? ORDER BY createdAt DESC",
      [dateKey],
    );
    const parsed = rows.map(parseSaleRow);

    let revenue = 0;
    let profit = 0;

    for (const sale of parsed) {
      revenue += sale.totalAmount;
      for (const item of sale.items) {
        const cost =
          typeof item.costPrice === "number"
            ? item.costPrice
            : (db.getFirstSync<{ costPrice: number }>(
                "SELECT costPrice FROM products WHERE id = ?",
                [item.productId],
              )?.costPrice ?? 0);
        profit += (item.unitPrice - cost) * item.quantity;
      }
    }

    setSales(parsed);
    setSummary({
      revenue: round2(revenue),
      profit: round2(profit),
      count: parsed.length,
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadSales(activeDate);
    }, [activeDate, loadSales]),
  );

  const shiftDay = useCallback(
    (days: number) => {
      setDateInput(shiftDateKey(activeDate, days));
    },
    [activeDate],
  );

  const voidSale = useCallback(
    (sale: Sale) => {
      Alert.alert(
        "Void sale",
        "Remove this sale and put its items back into stock? Credit payments already received are not affected.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Void sale",
            style: "destructive",
            onPress: () => {
              db.withTransactionSync(() => {
                db.runSync("DELETE FROM sales WHERE id = ?", [sale.id]);
                for (const item of sale.items) {
                  db.runSync(
                    "UPDATE products SET stockQty = stockQty + ?, updatedAt = ? WHERE id = ?",
                    [item.quantity, Date.now(), item.productId],
                  );
                }
              });
              loadSales(activeDate);
            },
          },
        ],
      );
    },
    [activeDate, loadSales],
  );

  const kpis = useMemo(
    () => [
      { label: "Revenue", value: formatRand(summary.revenue), danger: false },
      {
        label: "Est. profit",
        value: formatRand(summary.profit),
        danger: summary.profit < 0,
      },
      { label: "Sales", value: String(summary.count), danger: false },
    ],
    [summary],
  );

  return (
    <Container isScrollable={false} className="px-4 pt-3">
      <View className="mb-3 flex-row items-center gap-2">
        <Pressable
          accessibilityLabel="Previous day"
          onPress={() => shiftDay(-1)}
          className="h-10 w-10 items-center justify-center rounded-xl bg-surface active:opacity-70"
        >
          <Ionicons name="chevron-back" size={18} color={themeColorForeground} />
        </Pressable>
        <View className="flex-1">
          <TextField>
            <Input
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
              value={dateInput}
              onChangeText={setDateInput}
            />
          </TextField>
        </View>
        <Pressable
          accessibilityLabel="Next day"
          onPress={() => shiftDay(1)}
          className="h-10 w-10 items-center justify-center rounded-xl bg-surface active:opacity-70"
        >
          <Ionicons name="chevron-forward" size={18} color={themeColorForeground} />
        </Pressable>
        <Button size="sm" variant="secondary" onPress={() => setDateInput(todayKey())}>
          <Button.Label>Today</Button.Label>
        </Button>
      </View>

      <View className="mb-4 flex-row gap-2">
        {kpis.map((kpi) => (
          <View key={kpi.label} className="flex-1 rounded-xl bg-surface p-3">
            <Text className="text-xs text-muted">{kpi.label}</Text>
            <Text
              className={`mt-1 font-semibold ${kpi.danger ? "text-danger" : "text-foreground"}`}
            >
              {kpi.value}
            </Text>
          </View>
        ))}
      </View>

      <Separator className="mb-3" />

      <FlatList
        data={sales}
        keyExtractor={(item) => item.id}
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        ListEmptyComponent={
          <Text className="mt-10 text-center text-sm text-muted">
            No sales recorded for {activeDate}.
          </Text>
        }
        renderItem={({ item }) => (
          <View className="mb-2 flex-row items-center justify-between rounded-xl bg-surface p-4">
            <View className="flex-1 pr-3">
              <View className="flex-row items-center gap-2">
                <Text className="text-sm font-semibold text-foreground">
                  {formatTime(item.createdAt)}
                </Text>
                <Chip
                  size="sm"
                  variant="soft"
                  color={
                    item.paymentMethod === "CASH"
                      ? "success"
                      : item.paymentMethod === "TICK"
                        ? "warning"
                        : "accent"
                  }
                >
                  <Chip.Label>
                    {item.paymentMethod}
                    {item.customerName ? ` - ${item.customerName}` : ""}
                  </Chip.Label>
                </Chip>
              </View>
              <Text className="mt-1 text-xs text-muted" numberOfLines={2}>
                {item.items
                  .map((entry) => `${entry.quantity}x ${entry.productName}`)
                  .join(", ")}
              </Text>
            </View>
            <View className="items-end gap-2">
              <Text className="font-semibold text-foreground">
                {formatRand(item.totalAmount)}
              </Text>
              <Pressable
                accessibilityLabel="Void sale"
                onPress={() => voidSale(item)}
                className="active:opacity-60"
              >
                <Ionicons name="trash-outline" size={16} color={themeColorForeground} />
              </Pressable>
            </View>
          </View>
        )}
      />
    </Container>
  );
}
