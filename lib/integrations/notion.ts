import { getNotionTokens } from "./notion-token-store";

// Cliente Notion read-only (sin SDK). Proyección mínima: solo se devuelven
// nombre, dominio/email, etapa y pageId; el resto de propiedades se descarta.
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

export interface NotionAccountCandidate {
  notionPageId: string;
  name: string;
  domain: string | null;
  stage: string | null;
  specialist: string | null;
}

interface NotionProperty {
  type: string;
  [key: string]: unknown;
}

// Token OAuth (.data/notion-tokens.json) con fallback a NOTION_TOKEN (integración interna).
async function getAccessToken(): Promise<string | null> {
  return (await getNotionTokens())?.accessToken ?? process.env.NOTION_TOKEN ?? null;
}

export async function isNotionConnected(): Promise<boolean> {
  return Boolean(await getAccessToken());
}

export function hasAccountsDb(): boolean {
  return Boolean(process.env.NOTION_ACCOUNTS_DB_ID);
}

async function notionFetch<T>(pathname: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error("notion_not_connected");
  const res = await fetch(`${NOTION_API}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`notion_${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

// Convierte cualquier tipo de propiedad de Notion a texto plano.
function propertyToText(prop: NotionProperty | undefined): string | null {
  if (!prop) return null;
  const value = prop[prop.type] as unknown;
  switch (prop.type) {
    case "title":
    case "rich_text":
      return (value as { plain_text: string }[]).map((t) => t.plain_text).join("") || null;
    case "select":
    case "status":
      return (value as { name: string } | null)?.name ?? null;
    case "multi_select":
      return (value as { name: string }[]).map((o) => o.name).join(", ") || null;
    case "people":
      return (
        (value as { name?: string; person?: { email?: string } }[])
          .map((p) => [p.name, p.person?.email].filter(Boolean).join(" "))
          .join(", ") || null
      );
    case "email":
    case "url":
    case "phone_number":
      return (value as string | null) ?? null;
    case "rollup": {
      const arr = (value as { array?: NotionProperty[] }).array ?? [];
      return arr.map(propertyToText).filter(Boolean).join(", ") || null;
    }
    case "formula": {
      const f = value as { type: string; [k: string]: unknown };
      const v = f[f.type];
      return v == null ? null : String(v);
    }
    default:
      return null;
  }
}

// Filtro server-side cuando el tipo lo permite; "people" se filtra en cliente
// porque la API exige el user ID de Notion, no el nombre.
function buildSpecialistFilter(propName: string, propType: string, value: string) {
  switch (propType) {
    case "select":
      return { property: propName, select: { equals: value } };
    case "status":
      return { property: propName, status: { equals: value } };
    case "multi_select":
      return { property: propName, multi_select: { contains: value } };
    case "rich_text":
    case "title":
      return { property: propName, [propType]: { contains: value } };
    default:
      return undefined;
  }
}

export interface NotionDbSchema {
  title: string;
  properties: Record<string, string>; // nombre → tipo
}

export async function getAccountsDbSchema(): Promise<NotionDbSchema> {
  const db = await notionFetch<{
    title: { plain_text: string }[];
    properties: Record<string, { type: string }>;
  }>(`/databases/${process.env.NOTION_ACCOUNTS_DB_ID}`);
  return {
    title: db.title.map((t) => t.plain_text).join(""),
    properties: Object.fromEntries(
      Object.entries(db.properties).map(([name, p]) => [name, p.type]),
    ),
  };
}

export async function queryAssignedAccounts(): Promise<NotionAccountCandidate[]> {
  const nameProp = process.env.NOTION_PROP_NAME || "Name";
  const specialistProp = process.env.NOTION_PROP_SPECIALIST;
  const specialistValue = process.env.NOTION_SPECIALIST_VALUE?.trim();
  const domainProp = process.env.NOTION_PROP_DOMAIN;
  const stageProp = process.env.NOTION_PROP_STAGE;

  const schema = await getAccountsDbSchema();
  const specialistType = specialistProp ? schema.properties[specialistProp] : undefined;
  if (specialistProp && !specialistType) {
    throw new Error(`notion_property_not_found: ${specialistProp}`);
  }

  const filter =
    specialistProp && specialistType && specialistValue
      ? buildSpecialistFilter(specialistProp, specialistType, specialistValue)
      : undefined;

  const results: NotionAccountCandidate[] = [];
  let cursor: string | undefined;
  do {
    const page = await notionFetch<{
      results: { id: string; properties: Record<string, NotionProperty> }[];
      has_more: boolean;
      next_cursor: string | null;
    }>(`/databases/${process.env.NOTION_ACCOUNTS_DB_ID}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100, start_cursor: cursor, ...(filter && { filter }) }),
    });

    for (const row of page.results) {
      const specialist = specialistProp ? propertyToText(row.properties[specialistProp]) : null;
      // Filtro en cliente para "people" (u otros tipos sin filtro server-side).
      if (
        specialistValue &&
        !filter &&
        !specialist?.toLowerCase().includes(specialistValue.toLowerCase())
      ) {
        continue;
      }
      results.push({
        notionPageId: row.id,
        name: propertyToText(row.properties[nameProp]) ?? "(sin nombre)",
        domain: domainProp ? propertyToText(row.properties[domainProp]) : null,
        stage: stageProp ? propertyToText(row.properties[stageProp]) : null,
        specialist,
      });
    }
    cursor = page.has_more ? (page.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return results;
}

// Bases compartidas con la integración (para encontrar NOTION_ACCOUNTS_DB_ID).
export async function listSharedDatabases(): Promise<{ id: string; title: string; url: string }[]> {
  const res = await notionFetch<{
    results: { id: string; url: string; title: { plain_text: string }[] }[];
  }>("/search", {
    method: "POST",
    body: JSON.stringify({ filter: { property: "object", value: "database" }, page_size: 50 }),
  });
  return res.results.map((db) => ({
    id: db.id.replace(/-/g, ""),
    title: db.title.map((t) => t.plain_text).join("") || "(sin título)",
    url: db.url,
  }));
}
