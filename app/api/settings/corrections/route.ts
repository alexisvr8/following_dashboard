import { applyCorrectionEverywhere } from "@/lib/store/clients-store";
import { getSettings, updateSettings } from "@/lib/store/settings-store";

// Correcciones aprendidas ("Extract" → "Xtract"). POST agrega una y la aplica a todo lo guardado (minutas,
// transcripciones, accionables); las minutas nuevas ya llegan corregidas. DELETE la quita de la lista (lo ya
// corregido queda como está).

export async function GET() {
  return Response.json({ corrections: (await getSettings()).corrections });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { from?: unknown; to?: unknown };
  const from = typeof body.from === "string" ? body.from.trim() : "";
  const to = typeof body.to === "string" ? body.to.trim() : "";
  if (!from || !to || from === to || from.length > 80 || to.length > 80) {
    return Response.json({ error: "invalid_correction" }, { status: 400 });
  }
  const { corrections } = await getSettings();
  const next = [...corrections.filter((c) => c.from.toLowerCase() !== from.toLowerCase()), { from, to }];
  const saved = await updateSettings({ corrections: next });
  const updatedClients = await applyCorrectionEverywhere({ from, to });
  return Response.json({ corrections: saved.corrections, updatedClients });
}

export async function DELETE(request: Request) {
  const from = new URL(request.url).searchParams.get("from")?.trim().toLowerCase();
  if (!from) return Response.json({ error: "invalid_correction" }, { status: 400 });
  const { corrections } = await getSettings();
  const saved = await updateSettings({ corrections: corrections.filter((c) => c.from.toLowerCase() !== from) });
  return Response.json({ corrections: saved.corrections });
}
