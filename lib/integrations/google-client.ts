import { google } from "googleapis";
import { getTokens, saveTokens, type GoogleTokens } from "./google-token-store";

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

  return client;
}
