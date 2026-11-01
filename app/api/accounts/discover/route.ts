import {
  getAccountsDbSchema,
  hasAccountsDb,
  isNotionConnected,
  listSharedDatabases,
  queryAssignedAccounts,
} from "@/lib/integrations/notion";

// Read-only: lista las cuentas candidatas desde Notion para validarlas a mano. No persiste.
// Sin NOTION_ACCOUNTS_DB_ID → devuelve las bases compartidas para elegir el ID.
// `?schema=1` → solo nombres/tipos de propiedades (para llenar NOTION_PROP_*).
export async function GET(request: Request) {
  if (!(await isNotionConnected())) {
    return Response.json({ error: "notion_not_connected" }, { status: 409 });
  }
  try {
    if (!hasAccountsDb()) {
      return Response.json({
        error: "missing_NOTION_ACCOUNTS_DB_ID",
        sharedDatabases: await listSharedDatabases(),
      });
    }
    if (new URL(request.url).searchParams.get("schema")) {
      return Response.json(await getAccountsDbSchema());
    }
    const candidates = await queryAssignedAccounts();
    return Response.json({ count: candidates.length, candidates });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 502 });
  }
}
