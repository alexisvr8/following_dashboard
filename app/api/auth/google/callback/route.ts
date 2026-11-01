import { createOAuthClient } from "@/lib/integrations/google-client";
import { saveTokens } from "@/lib/integrations/google-token-store";

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code");
  if (!code) {
    return Response.json({ error: "missing_code" }, { status: 400 });
  }

  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);

  if (!tokens.access_token || !tokens.refresh_token || !tokens.expiry_date) {
    return Response.json({ error: "incomplete_token_response" }, { status: 502 });
  }

  await saveTokens({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiryDate: tokens.expiry_date,
    scope: tokens.scope ?? "",
  });

  return Response.redirect(new URL("/", req.url));
}
