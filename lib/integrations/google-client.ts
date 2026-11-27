import { google } from "googleapis";
import { getTokens, saveTokens, type GoogleTokens } from "./google-token-store";
import { googlePausedUntil, isUserRateLimit, loadGooglePause, noteGoogleLimit, noteGoogleOk } from "./google-limit";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.readonly",
];

export function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
}

export async function getAuthorizedClient() {
  const tokens = await getTokens();
  if (!tokens) return null;

  const client = createOAuthClient();
  client.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expiry_date: tokens.expiryDate,
    scope: tokens.scope,
  });

  client.on("tokens", (newTokens) => {
    const merged: Omit<GoogleTokens, "obtainedAt"> = {
      accessToken: newTokens.access_token ?? tokens.accessToken,
      refreshToken: newTokens.refresh_token ?? tokens.refreshToken,
      expiryDate: newTokens.expiry_date ?? tokens.expiryDate,
      scope: newTokens.scope ?? tokens.scope,
    };
    void saveTokens(merged);
  });

  guardGmail(client);
  return client;
}

const GMAIL_URL = /gmail\.googleapis\.com|\/gmail\/v1\//;

/**
 * Todas las llamadas de googleapis pasan por `client.request`: acá se frena Gmail mientras dure su corte por exceso de
 * uso (cada pedido durante el corte lo renueva), se registra el corte y se avisa cuando vuelve a andar. Calendar y
 * Drive tienen cupo propio y siguen.
 */
function guardGmail(client: ReturnType<typeof createOAuthClient>) {
  const original = client.request.bind(client) as (opts: unknown) => Promise<unknown>;
  (client as unknown as { request: (opts: unknown) => Promise<unknown> }).request = async (opts: unknown) => {
    if (!GMAIL_URL.test(String((opts as { url?: unknown })?.url ?? ""))) return original(opts);
    await loadGooglePause();
    const paused = googlePausedUntil();
    if (paused) {
      throw Object.assign(new Error(`User-rate limit exceeded. Retry after ${paused}`), { code: 429, status: 429 });
    }
    try {
      const res = await original(opts);
      noteGoogleOk();
      return res;
    } catch (error) {
      const e = error as { code?: unknown; status?: unknown; response?: { status?: number } };
      if (Number(e.status ?? e.response?.status ?? e.code) === 429 || isUserRateLimit(error)) noteGoogleLimit(error);
      throw error;
    }
  };
}
