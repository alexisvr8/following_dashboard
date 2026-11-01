import { saveNotionTokens } from "@/lib/integrations/notion-token-store";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const error = params.get("error");
  if (error) return Response.json({ error }, { status: 400 });

  const code = params.get("code");
  if (!code) return Response.json({ error: "missing_code" }, { status: 400 });

  const basic = Buffer.from(
    `${process.env.NOTION_OAUTH_CLIENT_ID}:${process.env.NOTION_OAUTH_CLIENT_SECRET}`,
  ).toString("base64");

  const res = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.NOTION_REDIRECT_URI,
    }),
  });
  if (!res.ok) {
    return Response.json(
      { error: "notion_token_exchange_failed", detail: (await res.text()).slice(0, 300) },
      { status: 502 },
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string | null;
    workspace_name?: string | null;
    bot_id: string;
  };
  await saveNotionTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    workspaceName: data.workspace_name ?? null,
    botId: data.bot_id,
  });

  return Response.redirect(new URL("/conexiones", req.url));
}
