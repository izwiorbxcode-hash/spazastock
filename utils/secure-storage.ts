import * as SecureStore from "expo-secure-store";

const TOKENS_KEY = "spazastock.google.auth";

export interface GoogleAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export async function saveGoogleTokens(tokens: GoogleAuthTokens): Promise<void> {
  await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(tokens));
}

export async function getGoogleTokens(): Promise<GoogleAuthTokens | null> {
  const raw = await SecureStore.getItemAsync(TOKENS_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<GoogleAuthTokens>;
    if (typeof parsed.accessToken !== "string" || typeof parsed.refreshToken !== "string") {
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : 0,
    };
  } catch {
    return null;
  }
}

export async function clearGoogleTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKENS_KEY);
}
