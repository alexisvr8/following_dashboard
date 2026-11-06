import { getState, setState } from "@/lib/store/backend";

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
  scope: string;
  obtainedAt: number;
}

// `app_state.google_tokens` (o `.data/google-tokens.json` en modo local).
export async function saveTokens(tokens: Omit<GoogleTokens, "obtainedAt">): Promise<void> {
  const withTimestamp: GoogleTokens = { ...tokens, obtainedAt: Date.now() };
  await setState("google_tokens", withTimestamp);
}

export async function getTokens(): Promise<GoogleTokens | null> {
  try {
    return await getState<GoogleTokens>("google_tokens");
  } catch {
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  await setState("google_tokens", null);
}
