import { useFocusEffect } from "expo-router";
import {
  Button,
  Dialog,
  Input,
  Label,
  SearchField,
  TextField,
} from "heroui-native";
import { useCallback, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import db from "@/database/db";
import { formatRand } from "@/utils/format";

interface CustomerTab {
  key: string;
  customerName: string;
  owed: number;
  paid: number;
  slips: number;
  lastActivity: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export default function CreditScreen() {
  const [tabs, setTabs] = useState<CustomerTab[]>([]);
  const [search, setSearch] = useState("");

  const [selectedTab, setSelectedTab] = useState<CustomerTab | null>(null);
  const [settleVisible, setSettleVisible] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");

  const loadTabs = useCallback(() => {
    const sales = db.getAllSync<{ customerName: string; totalAmount: number; createdAt: number }>(
      "SELECT customerName, totalAmount, createdAt FROM sales WHERE paymentMethod = 'TICK' AND customerName IS NOT NULL ORDER BY createdAt DESC",
    );
    const payments = db.getAllSync<{ customerName: string; amount: number; createdAt: number }>(
      "SELECT customerName, amount, createdAt FROM payments",
    );

    const byCustomer = new Map<string, CustomerTab>();

    for (const sale of sales) {
      const key = sale.customerName.trim().toLowerCase();
      const entry = byCustomer.get(key);

      if (entry) {
        entry.owed = round2(entry.owed + sale.totalAmount);
        entry.slips += 1;
        entry.lastActivity = Math.max(entry.lastActivity, sale.createdAt);
      } else {
        byCustomer.set(key, {
          key,
          customerName: sale.customerName.trim(),
          owed: sale.totalAmount,
          paid: 0,
          slips: 1,
          lastActivity: sale.createdAt,
        });
      }
    }

    for (const payment of payments) {
      const key = payment.customerName.trim().toLowerCase();
      const entry = byCustomer.get(key);
      if (!entry) continue;
      entry.paid = round2(entry.paid + payment.amount);
      entry.lastActivity = Math.max(entry.lastActivity, payment.createdAt);
    }

    setTabs(
      [...byCustomer.values()]
        .filter((entry) => round2(entry.owed - entry.paid) > 0.004)
        .sort((a, b) => round2(b.owed - b.paid) - round2(a.owed - a.paid)),
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadTabs();
    }, [loadTabs]),
  );

  const visibleTabs = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return tabs;
    return tabs.filter((tab) => tab.customerName.toLowerCase().includes(term));
  }, [search, tabs]);

  const totalOutstanding = useMemo(
    () => round2(tabs.reduce((sum, tab) => sum + round2(tab.owed - tab.paid), 0)),
    [tabs],
  );

  const openSettleDialog = useCallback((tab: CustomerTab) => {
    setSelectedTab(tab);
    setPaymentAmount(round2(tab.owed - tab.paid).toFixed(2));
    setSettleVisible(true);
  }, []);

  const settleDebt = useCallback(() => {
    if (!selectedTab) return;

    const amount = Number.parseFloat(paymentAmount);
    const outstanding = round2(selectedTab.owed - selectedTab.paid);

    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert("Invalid amount", "Enter how much the customer paid.");
      return;
    }
    if (amount - outstanding > 0.004) {
      Alert.alert("Too much", `The outstanding balance is only ${formatRand(outstanding)}.`);
      return;
    }

    db.runSync(
      "INSERT INTO payments (id, customerName, amount, note, createdAt) VALUES (?, ?, ?, ?, ?)",
      [
        `${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        selectedTab.customerName,
        round2(amount),
        null,
        Date.now(),
      ],
    );

    const remaining = round2(outstanding - amount);
    setSettleVisible(false);
    setSelectedTab(null);
    loadTabs();

    Alert.alert(
      "Payment recorded",
      remaining > 0.004
        ? `${selectedTab.customerName} still owes ${formatRand(remaining)}.`
        : `${selectedTab.customerName}'s tab is fully settled.`,
    );
  }, [loadTabs, paymentAmount, selectedTab]);

  return (
    <Container isScrollable={false} className="px-4 pt-3">
      <View className="mb-3">
        <SearchField value={search} onChange={setSearch}>
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Search customer" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
      </View>

      <View className="mb-3 rounded-xl bg-surface p-4">
        <Text className="text-xs text-muted">Outstanding on the book</Text>
        <Text className="mt-1 text-2xl font-bold text-foreground">
          {formatRand(totalOutstanding)}
        </Text>
        <Text className="mt-1 text-xs text-muted">
          {tabs.length} {tabs.length === 1 ? "customer" : "customers"} with open tabs
        </Text>
      </View>

      <FlatList
        data={visibleTabs}
        keyExtractor={(item) => item.key}
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        ListEmptyComponent={
          <Text className="mt-10 text-center text-sm text-muted">
            No outstanding customer tabs. Everything on the book is settled.
          </Text>
        }
        renderItem={({ item }) => {
          const outstanding = round2(item.owed - item.paid);
          return (
            <View className="mb-2 flex-row items-center justify-between rounded-xl bg-surface p-4">
              <Pressable className="flex-1 pr-3" onPress={() => openSettleDialog(item)}>
                <Text className="font-semibold text-foreground">{item.customerName}</Text>
                <Text className="mt-1 text-xs text-muted">
                  {item.slips} {item.slips === 1 ? "slip" : "slips"} on the book
                  {item.paid > 0 ? ` | ${formatRand(item.paid)} paid so far` : ""}
                </Text>
              </Pressable>
              <View className="items-end gap-2">
                <Text className="font-bold text-danger">{formatRand(outstanding)}</Text>
                <Button size="sm" onPress={() => openSettleDialog(item)}>
                  <Button.Label>Settle</Button.Label>
                </Button>
              </View>
            </View>
          );
        }}
      />

      <Dialog
        isOpen={settleVisible}
        onOpenChange={(open) => {
          if (!open) {
            setSettleVisible(false);
            setSelectedTab(null);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content>
            <Dialog.Title>Settle tab</Dialog.Title>
            <Dialog.Description>
              {selectedTab
                ? `${selectedTab.customerName} owes ${formatRand(
                    round2(selectedTab.owed - selectedTab.paid),
                  )}.`
                : ""}
            </Dialog.Description>

            <TextField className="mt-4">
              <Label>Amount received</Label>
              <Input
                keyboardType="decimal-pad"
                value={paymentAmount}
                onChangeText={setPaymentAmount}
                placeholder="0.00"
              />
            </TextField>

            <Button className="mt-5" onPress={settleDebt}>
              <Button.Label>Record payment</Button.Label>
            </Button>
            <Button
              className="mt-2"
              variant="secondary"
              onPress={() => {
                setSettleVisible(false);
                setSelectedTab(null);
              }}
            >
              <Button.Label>Cancel</Button.Label>
            </Button>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </Container>
  );
}
