import { setNotToday } from "@/lib/store/not-today-store";

/** `{id, skip, forceOn?}` → saca (o devuelve) una card de "Hoy" por agenda, solo por hoy; `forceOn` (AAAA-MM-DD) la fija en Hoy ese día. */
export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as { id?: unknown; skip?: unknown; forceOn?: unknown } | null;
  if (typeof body?.id !== "string" || typeof body.skip !== "boolean") return Response.json({ error: "id_skip_required" }, { status: 400 });
  await setNotToday(body.id, body.skip, typeof body.forceOn === "string" ? body.forceOn : null);
  return Response.json({ ok: true });
}
