import { createOAuthClient, GOOGLE_SCOPES } from "@/lib/integrations/google-client";

export async function GET() {
  const client = createOAuthClient();
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
  });

  return Response.redirect(url);
}
