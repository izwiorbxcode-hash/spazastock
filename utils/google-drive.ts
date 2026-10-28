import { Platform } from "react-native";

import { buildBackupPayload, importBackupPayload } from "@/database/backup";
import { clearGoogleTokens, getGoogleTokens, saveGoogleTokens } from "@/utils/secure-storage";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export const DRIVE_BACKUP_FILE_NAME = "spazastock-backup.json";
export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";

export interface GoogleClientIds {
  androidClientId?: string;
  iosClientId?: string;
  webClientId?: string;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function getGoogleClientIds(): GoogleClientIds {
  return {
    androidClientId: clean(process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID),
    iosClientId: clean(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID),
    webClientId: clean(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID),
  };
}

function getPlatformClientId(): string | undefined {
  const ids = getGoogleClientIds();
  return Platform.select({
    ios: ids.iosClientId,
    android: ids.androidClientId,
    default: ids.webClientId,
  });
}

export function isGoogleDriveConfigured(): boolean {
  return getPlatformClientId() !== undefined;
}

export async function hasGoogleSession(): Promise<boolean> {
  return (await getGoogleTokens()) !== null;
}

export async function getValidAccessToken(): Promise<string | null> {
  const tokens = await getGoogleTokens();
  if (!tokens) return null;

  if (tokens.expiresAt - 120_000 > Date.now()) {
    return tokens.accessToken;
  }

  const clientId = getPlatformClientId();
  if (!clientId) return null;

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      refresh_token: tokens.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!response.ok) {
    await clearGoogleTokens();
    return null;
  }

  const data = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!data.access_token) {
    await clearGoogleTokens();
    return null;
  }

  await saveGoogleTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  });

  return data.access_token;
}

export async function disconnectGoogleDrive(): Promise<void> {
  await clearGoogleTokens();
}

async function driveFetch(
  accessToken: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Google Drive request failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  return response;
}

async function findBackupFileId(accessToken: string): Promise<string | null> {
  const query = encodeURIComponent(`name='${DRIVE_BACKUP_FILE_NAME}' and trashed=false`);
  const response = await driveFetch(
    accessToken,
    `${DRIVE_API}/files?spaces=appDataFolder&q=${query}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`,
  );
  const data = (await response.json()) as { files?: { id: string }[] };
  return data.files?.[0]?.id ?? null;
}

export async function uploadBackupToDrive(): Promise<void> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error("Not connected to Google Drive. Please connect your Google account first.");
  }

  const payload = buildBackupPayload();
  const body = JSON.stringify(payload);
  const existingFileId = await findBackupFileId(accessToken);

  let fileId = existingFileId;
  if (!fileId) {
    const metadataResponse = await driveFetch(accessToken, `${DRIVE_API}/files?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: DRIVE_BACKUP_FILE_NAME,
        mimeType: "application/json",
        parents: ["appDataFolder"],
      }),
    });
    const metadata = (await metadataResponse.json()) as { id: string };
    fileId = metadata.id;
  }

  await driveFetch(accessToken, `${DRIVE_UPLOAD_API}/files/${fileId}?uploadType=media`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

export async function restoreBackupFromDrive(): Promise<number> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error("Not connected to Google Drive. Please connect your Google account first.");
  }

  const fileId = await findBackupFileId(accessToken);
  if (!fileId) {
    throw new Error("No Spaza OS backup was found on this Google account yet.");
  }

  const response = await driveFetch(accessToken, `${DRIVE_API}/files/${fileId}?alt=media`);
  const payload = JSON.parse(await response.text());
  return importBackupPayload(payload);
}
