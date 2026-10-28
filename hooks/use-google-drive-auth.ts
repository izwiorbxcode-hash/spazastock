import * as Google from "expo-auth-session/providers/google";
import { useCallback, useEffect, useState } from "react";

import { GOOGLE_DRIVE_SCOPE, getGoogleClientIds } from "@/utils/google-drive";
import { getGoogleTokens, saveGoogleTokens } from "@/utils/secure-storage";

export type GoogleAuthStatus = "idle" | "connecting" | "saving" | "done" | "error";

export function useGoogleDriveAuth(onConnected: () => void) {
  const { androidClientId, iosClientId, webClientId } = getGoogleClientIds();
  const [status, setStatus] = useState<GoogleAuthStatus>("idle");

  const [, response, promptAsync] = Google.useAuthRequest({
    androidClientId,
    iosClientId,
    webClientId,
    scopes: [GOOGLE_DRIVE_SCOPE],
    extraParams: { access_type: "offline", prompt: "consent" },
  });

  useEffect(() => {
    if (!response) return;

    if (response.type === "error") {
      setStatus("error");
      return;
    }

    if (response.type !== "success") return;

    const authentication = response.authentication;
    if (!authentication?.accessToken) {
      setStatus("error");
      return;
    }

    setStatus("saving");
    void (async () => {
      const existing = await getGoogleTokens();
      await saveGoogleTokens({
        accessToken: authentication.accessToken,
        refreshToken: authentication.refreshToken ?? existing?.refreshToken ?? "",
        expiresAt: Date.now() + (authentication.expiresIn ?? 3600) * 1000,
      });
      setStatus("done");
      onConnected();
    })();
  }, [response, onConnected]);

  const connect = useCallback(() => {
    setStatus("connecting");
    void promptAsync();
  }, [promptAsync]);

  return { connect, status };
}
