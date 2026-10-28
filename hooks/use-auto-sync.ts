import * as Network from "expo-network";
import { useEffect, useRef } from "react";

import { LAST_GOOGLE_SYNC_KEY, getSetting, setSetting } from "@/database/db";
import { getValidAccessToken, uploadBackupToDrive } from "@/utils/google-drive";

const SYNC_THROTTLE_MS = 30 * 60 * 1000;

export function useAutoSync(): void {
  const syncingRef = useRef(false);

  useEffect(() => {
    const maybeSync = async (isOnline: boolean) => {
      if (!isOnline || syncingRef.current) return;

      const lastSync = Number.parseInt(getSetting(LAST_GOOGLE_SYNC_KEY) ?? "0", 10);
      if (Number.isFinite(lastSync) && Date.now() - lastSync < SYNC_THROTTLE_MS) return;

      syncingRef.current = true;
      try {
        const accessToken = await getValidAccessToken();
        if (!accessToken) return;

        await uploadBackupToDrive();
        setSetting(LAST_GOOGLE_SYNC_KEY, String(Date.now()));
      } catch (error) {
        console.warn("Auto-sync to Google Drive failed:", error);
      } finally {
        syncingRef.current = false;
      }
    };

    const subscription = Network.addNetworkStateListener((state) => {
      void maybeSync(isOnline(state));
    });

    void Network.getNetworkStateAsync().then((state) => {
      void maybeSync(isOnline(state));
    });

    return () => subscription.remove();
  }, []);
}

function isOnline(state: Network.NetworkState): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}
