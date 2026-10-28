import { useFocusEffect } from "expo-router";
import { Button, Input, Label, Separator, TextArea, TextField } from "heroui-native";
import { useCallback, useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";

import { Container } from "@/components/container";
import db from "@/database/db";
import type { CashUpRecord } from "@/types";
import { formatDateTime, formatRand, todayKey } from "@/utils/format";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export default function CashUpScreen() {
  const [cashSales, setCashSales] = useState(0);
  const [tickPayments, setTickPayments] = useState(0);
  const [actualCash, setActualCash] = useState("");
  const [notes, setNotes] = useState("");
  const [recentCashUps, setRecentCashUps] = useState<CashUpRecord[]>([]);

  const expectedCash = useMemo(() => round2(cashSales + tickPayments), [cashSales, tickPayments]);

  const parsedActual = Number.parseFloat(actualCash);
  const hasActual = Number.isFinite(parsedActual);
  const variance = hasActual ? round2(parsedActual - expectedCash) : 0;

  const loadData = useCallback(() => {
    const today = todayKey();

    const cashRow = db.getFirstSync<{ total: number | null }>(
      "SELECT SUM(totalAmount) AS total FROM sales WHERE paymentMethod = 'CASH' AND date(createdAt / 1000, 'unixepoch', 'localtime') = ?",
      [today],
    );
    const paymentRow = db.getFirstSync<{ total: number | null }>(
      "SELECT SUM(amount) AS total FROM payments WHERE date(createdAt / 1000, 'unixepoch', 'localtime') = ?",
      [today],
    );

    setCashSales(cashRow?.total ?? 0);
    setTickPayments(paymentRow?.total ?? 0);
    setRecentCashUps(
      db.getAllSync<CashUpRecord>(
        "SELECT * FROM cashups ORDER BY createdAt DESC LIMIT 10",
      ),
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const saveCashUp = useCallback(() => {
    if (!hasActual) {
      Alert.alert("Count the drawer", "Enter the actual cash counted in the drawer.");
      return;
    }

    const today = todayKey();
    const roundedActual = round2(parsedActual);
    const derivedVariance = round2(roundedActual - expectedCash);

    db.runSync(
      "INSERT INTO cashups (id, date, expectedCash, actualCash, variance, notes, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        today,
        expectedCash,
        roundedActual,
        derivedVariance,
        notes.trim() || null,
        Date.now(),
      ],
    );

    setActualCash("");
    setNotes("");
    loadData();

    const difference =
      Math.abs(derivedVariance) < 0.005
        ? "The drawer balances exactly."
        : derivedVariance > 0
          ? `Drawer is ${formatRand(derivedVariance)} over.`
          : `Drawer is ${formatRand(Math.abs(derivedVariance))} short.`;

    Alert.alert("Cash-up saved", `Expected ${formatRand(expectedCash)}. ${difference}`);
  }, [expectedCash, hasActual, loadData, notes, parsedActual]);

  return (
    <Container className="px-4 pt-3">
      <Text className="text-xs text-muted">Expected in the drawer today</Text>
      <Text className="mt-1 text-3xl font-bold text-foreground">{formatRand(expectedCash)}</Text>

      <View className="mt-3 flex-row gap-2">
        <View className="flex-1 rounded-xl bg-surface p-3">
          <Text className="text-xs text-muted">Cash sales</Text>
          <Text className="mt-1 font-semibold text-foreground">{formatRand(round2(cashSales))}</Text>
        </View>
        <View className="flex-1 rounded-xl bg-surface p-3">
          <Text className="text-xs text-muted">Tick payments</Text>
          <Text className="mt-1 font-semibold text-foreground">{formatRand(round2(tickPayments))}</Text>
        </View>
      </View>

      <View className="mt-5 gap-3">
        <TextField>
          <Label>Actual cash counted in drawer</Label>
          <Input
            placeholder="0.00"
            keyboardType="decimal-pad"
            value={actualCash}
            onChangeText={setActualCash}
          />
        </TextField>

        {hasActual ? (
          <View
            className={`rounded-xl p-3 ${
              Math.abs(variance) < 0.005 ? "bg-surface" : "bg-surface"
            }`}
          >
            <Text className="text-xs text-muted">Variance (actual - expected)</Text>
            <Text
              className={`mt-1 font-bold ${
                Math.abs(variance) < 0.005
                  ? "text-success"
                  : variance > 0
                    ? "text-foreground"
                    : "text-danger"
              }`}
            >
              {formatRand(variance)}
            </Text>
          </View>
        ) : null}

        <TextField>
          <Label>Notes (optional)</Label>
          <TextArea
            placeholder="Expenses paid from the drawer, airtime, etc."
            value={notes}
            onChangeText={setNotes}
          />
        </TextField>

        <Button onPress={saveCashUp}>
          <Button.Label>Close shift & save cash-up</Button.Label>
        </Button>
      </View>

      {recentCashUps.length > 0 ? (
        <View className="mt-6">
          <Separator className="mb-3" />
          <Text className="mb-2 font-semibold text-foreground">Recent cash-ups</Text>
          {recentCashUps.map((record) => (
            <View key={record.id} className="mb-2 rounded-xl bg-surface p-3">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-medium text-foreground">{record.date}</Text>
                <Text
                  className={`text-sm font-semibold ${
                    Math.abs(record.variance) < 0.005
                      ? "text-success"
                      : record.variance > 0
                        ? "text-foreground"
                        : "text-danger"
                  }`}
                >
                  {formatRand(record.variance)}
                </Text>
              </View>
              <Text className="mt-1 text-xs text-muted">
                Expected {formatRand(record.expectedCash)} | Counted{" "}
                {formatRand(record.actualCash)} | {formatDateTime(record.createdAt)}
              </Text>
              {record.notes ? (
                <Text className="mt-1 text-xs text-muted">{record.notes}</Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </Container>
  );
}
