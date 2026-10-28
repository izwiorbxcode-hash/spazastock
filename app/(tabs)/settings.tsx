import Constants from "expo-constants";
import { useFocusEffect } from "expo-router";
import { Button, Input, Label, Spinner, TextField } from "heroui-native";
import { useCallback, useState } from "react";
import { Alert, Text, View } from "react-native";

import { Container } from "@/components/container";
import { GoogleDriveSettings } from "@/components/google-drive-settings";
import { useAppTheme } from "@/contexts/app-theme-context";
import {
  exportBackupToFile,
  pickAndRestoreBackup,
} from "@/database/backup";
import { LOW_STOCK_THRESHOLD_KEY, getLowStockThreshold, setSetting } from "@/database/db";

export default function SettingsScreen() {
  const { isLight, toggleTheme } = useAppTheme();

  const [thresholdInput, setThresholdInput] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setThresholdInput(String(getLowStockThreshold()));
    }, []),
  );

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      await exportBackupToFile();
    } catch (error) {
      Alert.alert(
        "Export failed",
        error instanceof Error ? error.message : "Could not create the backup file.",
      );
    } finally {
      setIsExporting(false);
    }
  }, []);

  const performRestore = useCallback(async () => {
    setIsRestoring(true);
    try {
      const productCount = await pickAndRestoreBackup();
      if (productCount !== null) {
        Alert.alert("Restore complete", `Imported ${productCount} products from the backup file.`);
      }
    } catch (error) {
      Alert.alert(
        "Restore failed",
        error instanceof Error ? error.message : "That file could not be restored.",
      );
    } finally {
      setIsRestoring(false);
    }
  }, []);

  const handleRestore = useCallback(() => {
    Alert.alert(
      "Restore from file",
      "This replaces everything on this phone with the backup file you pick. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Pick file", onPress: () => void performRestore() },
      ],
    );
  }, [performRestore]);

  const saveThreshold = useCallback(() => {
    const parsed = Number.parseInt(thresholdInput, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      Alert.alert("Invalid number", "Enter a whole number of units, like 5.");
      return;
    }
    setSetting(LOW_STOCK_THRESHOLD_KEY, String(parsed));
    Alert.alert("Saved", `Low stock warnings will show at ${parsed} units or fewer.`);
  }, [thresholdInput]);

  return (
    <Container className="px-4 pt-3">
      <GoogleDriveSettings />

      <View className="mb-3 rounded-xl bg-surface p-4">
        <Text className="font-semibold text-foreground">Offline file backup</Text>
        <Text className="mt-1 text-xs text-muted">
          Export a backup file and save it to WhatsApp, Files, Google Drive, or iCloud
          yourself. Restore it any time, even without internet.
        </Text>
        <View className="mt-4 flex-row gap-2">
          <Button
            className="flex-1"
            variant="secondary"
            isDisabled={isExporting || isRestoring}
            onPress={() => void handleExport()}
          >
            {isExporting ? <Spinner size="sm" /> : null}
            <Button.Label>{isExporting ? "Exporting..." : "Export backup"}</Button.Label>
          </Button>
          <Button
            className="flex-1"
            variant="secondary"
            isDisabled={isExporting || isRestoring}
            onPress={handleRestore}
          >
            {isRestoring ? <Spinner size="sm" /> : null}
            <Button.Label>{isRestoring ? "Restoring..." : "Restore file"}</Button.Label>
          </Button>
        </View>
      </View>

      <View className="mb-3 rounded-xl bg-surface p-4">
        <Text className="font-semibold text-foreground">Low stock threshold</Text>
        <Text className="mt-1 text-xs text-muted">
          Products at or below this quantity get flagged in Stock and POS.
        </Text>
        <View className="mt-3 flex-row items-end gap-2">
          <TextField className="flex-1">
            <Label>Units</Label>
            <Input
              keyboardType="number-pad"
              value={thresholdInput}
              onChangeText={setThresholdInput}
            />
          </TextField>
          <Button onPress={saveThreshold}>
            <Button.Label>Save</Button.Label>
          </Button>
        </View>
      </View>

      <View className="mb-3 rounded-xl bg-surface p-4">
        <Text className="font-semibold text-foreground">Appearance</Text>
        <Text className="mt-1 text-xs text-muted">
          Currently using the {isLight ? "light" : "dark"} theme.
        </Text>
        <Button className="mt-3" variant="secondary" size="sm" onPress={toggleTheme}>
          <Button.Label>Switch to {isLight ? "dark" : "light"} mode</Button.Label>
        </Button>
      </View>

      <View className="mb-3 rounded-xl bg-surface p-4">
        <Text className="font-semibold text-foreground">Security</Text>
        <Text className="mt-1 text-xs text-muted">
          Spaza OS locks with your fingerprint, face, or device PIN every time it
          starts. All data stays on this phone unless you back it up yourself.
        </Text>
        <Text className="mt-3 text-xs text-muted">
          Version {Constants.expoConfig?.version ?? "1.0.0"}
        </Text>
      </View>
    </Container>
  );
}
