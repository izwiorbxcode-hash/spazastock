import { Ionicons } from "@expo/vector-icons";
import { Button, Chip, Spinner, useThemeColor } from "heroui-native";
import { useCallback, useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";

import { LAST_GOOGLE_SYNC_KEY, getSetting, setSetting } from "@/database/db";
import { useGoogleDriveAuth } from "@/hooks/use-google-drive-auth";
import { formatDateTime } from "@/utils/format";
import {
  disconnectGoogleDrive,
  hasGoogleSession,
  isGoogleDriveConfigured,
  restoreBackupFromDrive,
  uploadBackupToDrive,
} from "@/utils/google-drive";

export function GoogleDriveSettings() {
  if (!isGoogleDriveConfigured()) {
    return (
      <View className="mb-3 rounded-xl bg-surface p-4">
        <Text className="font-semibold text-foreground">Google Drive sync</Text>
        <Text className="mt-1 text-xs text-muted">
          Not configured yet. Add EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID and
          EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID to the app .env file to enable private
          Google Drive backups.
        </Text>
      </View>
    );
  }

  return <GoogleDriveSettingsConnected />;
}

function GoogleDriveSettingsConnected() {
  const themeColorForeground = useThemeColor("foreground");

  const [isConnected, setIsConnected] = useState(false);
  const [busy, setBusy] = useState<"backup" | "restore" | "disconnect" | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

  const refreshStatus = useCallback(() => {
    void hasGoogleSession().then(setIsConnected);
    const raw = getSetting(LAST_GOOGLE_SYNC_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    setLastSyncAt(Number.isFinite(parsed) ? parsed : null);
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const { connect, status } = useGoogleDriveAuth(refreshStatus);

  const handleBackup = useCallback(async () => {
    setBusy("backup");
    try {
      await uploadBackupToDrive();
      const now = Date.now();
      setSetting(LAST_GOOGLE_SYNC_KEY, String(now));
      setLastSyncAt(now);
      Alert.alert("Backup complete", "Your latest stock, sales and tabs are on Google Drive.");
    } catch (error) {
      Alert.alert(
        "Backup failed",
        error instanceof Error ? error.message : "Could not upload the backup to Google Drive.",
      );
    } finally {
      setBusy(null);
    }
  }, []);

  const performRestore = useCallback(async () => {
    setBusy("restore");
    try {
      const productCount = await restoreBackupFromDrive();
      refreshStatus();
      Alert.alert("Restore complete", `Imported ${productCount} products from Google Drive.`);
    } catch (error) {
      Alert.alert(
        "Restore failed",
        error instanceof Error ? error.message : "Could not restore the backup from Google Drive.",
      );
    } finally {
      setBusy(null);
    }
  }, [refreshStatus]);

  const handleRestore = useCallback(() => {
    Alert.alert(
      "Restore from Google Drive",
      "This replaces everything on this phone with your latest Google Drive backup. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Restore", style: "destructive", onPress: () => void performRestore() },
      ],
    );
  }, [performRestore]);

  const handleDisconnect = useCallback(async () => {
    setBusy("disconnect");
    try {
      await disconnectGoogleDrive();
      setIsConnected(false);
    } finally {
      setBusy(null);
    }
  }, []);

  return (
    <View className="mb-3 rounded-xl bg-surface p-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Ionicons name="cloud-outline" size={18} color={themeColorForeground} />
          <Text className="font-semibold text-foreground">Google Drive sync</Text>
        </View>
        {isConnected ? (
          <Chip size="sm" variant="soft" color="success">
            <Chip.Label>Connected</Chip.Label>
          </Chip>
        ) : null}
      </View>

      <Text className="mt-1 text-xs text-muted">
        Backups land in a private app folder on your own Google Drive. Nothing is stored
        on any other server.
      </Text>

      {lastSyncAt ? (
        <Text className="mt-2 text-xs text-muted">
          Last sync: {formatDateTime(lastSyncAt)}
        </Text>
      ) : null}

      {!isConnected ? (
        <Button
          className="mt-4"
          isDisabled={status === "connecting" || status === "saving"}
          onPress={connect}
        >
          {status === "connecting" || status === "saving" ? (
            <Spinner size="sm" color="#ffffff" />
          ) : (
            <Ionicons name="logo-google" size={18} color="#ffffff" />
          )}
          <Button.Label>
            {status === "connecting"
              ? "Connecting..."
              : status === "saving"
                ? "Finishing sign-in..."
                : "Connect Google account"}
          </Button.Label>
        </Button>
      ) : (
        <>
          {status === "error" ? (
            <Text className="mt-2 text-xs text-danger">
              Sign-in did not finish. Tap connect to try again.
            </Text>
          ) : null}
          <View className="mt-4 flex-row gap-2">
            <Button
              className="flex-1"
              isDisabled={busy !== null}
              onPress={() => void handleBackup()}
            >
              {busy === "backup" ? <Spinner size="sm" color="#ffffff" /> : null}
              <Button.Label>Backup now</Button.Label>
            </Button>
            <Button
              className="flex-1"
              variant="secondary"
              isDisabled={busy !== null}
              onPress={handleRestore}
            >
              {busy === "restore" ? <Spinner size="sm" /> : null}
              <Button.Label>Restore</Button.Label>
            </Button>
          </View>
          <Button
            className="mt-2"
            variant="ghost"
            size="sm"
            isDisabled={busy !== null}
            onPress={() => void handleDisconnect()}
          >
            <Button.Label>Disconnect Google account</Button.Label>
          </Button>
        </>
      )}
    </View>
  );
}
