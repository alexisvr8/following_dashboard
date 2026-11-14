import { analyzeAccounts } from "@/lib/integrations/account-analysis";
import { getClientsFile } from "@/lib/store/clients-store";

// Análisis semanal con IA. GET: estado por cuenta asignada. POST {ids?, force?}: corre el análisis (una cuenta
// tarda ~50 s; todas, ~10 min). Botón "Reanalizar" de la pestaña "Análisis IA" en /cuentas/[id].
export const maxDuration = 900;

export async function GET() {
  const file = await getClientsFile();
  return Response.json(
    file.clients
      .filter((c) => c.status === "assigned")
      .map((c) => ({
        id: c.id,
        name: c.name,
        week: c.analysis?.week ?? null,
        generatedAt: c.analysis?.generatedAt ?? null,
        estado: c.analysis?.output.estado ?? null,
        prioridad: c.analysis?.output.prioridad.nivel ?? null,
        error: c.analysisError?.message ?? null,
      })),
  );
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { ids?: unknown; force?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 50) : undefined;
  const res = await analyzeAccounts({ ids, force: body.force === true });
  return Response.json(res, { status: res.error ? 409 : 200 });
}
