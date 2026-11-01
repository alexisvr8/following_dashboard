export async function GET() {
  const url = new URL("https://api.notion.com/v1/oauth/authorize");
  url.searchParams.set("client_id", process.env.NOTION_OAUTH_CLIENT_ID ?? "");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("owner", "user");
  url.searchParams.set("redirect_uri", process.env.NOTION_REDIRECT_URI ?? "");
  return Response.redirect(url.toString());
}
