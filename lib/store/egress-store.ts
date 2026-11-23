import { getState, setState } from "@/lib/store/backend";
import { pendingEgress, type EgressByDay } from "@/lib/supabase/egress-meter";

// Egress de Supabase medido por la app (aprox.), por día, en `app_state.supabase_egress`. Ver `egress-meter.ts`.
const KEEP_DAYS = 40;

export async function addEgress(batch: EgressByDay): Promise<void> {
  const saved = (await getState<EgressByDay>("supabase_egress")) ?? {};
  for (const [day, v] of Object.entries(batch)) {
    const cur = (saved[day] ??= { bytes: 0, requests: 0 });
    cur.bytes += v.bytes;
    cur.requests += v.requests;
  }
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toLocaleDateString("en-CA");
  for (const day of Object.keys(saved)) if (day < cutoff) delete saved[day];
  await setState("supabase_egress", saved);
}

/** Totales de hoy y de los últimos `days` días (guardado + lo de este proceso aún sin guardar). */
export async function getEgressSummary(days = 30): Promise<{ today: number; total: number; requests: number }> {
  const saved = (await getState<EgressByDay>("supabase_egress").catch(() => null)) ?? {};
  for (const [day, v] of Object.entries(pendingEgress())) {
    const cur = (saved[day] ??= { bytes: 0, requests: 0 });
    cur.bytes += v.bytes;
    cur.requests += v.requests;
  }
  const todayKey = new Date().toLocaleDateString("en-CA");
  const cutoff = new Date(Date.now() - (days - 1) * 86_400_000).toLocaleDateString("en-CA");
  let total = 0;
  let requests = 0;
  for (const [day, v] of Object.entries(saved)) {
    if (day < cutoff) continue;
    total += v.bytes;
    requests += v.requests;
  }
  return { today: saved[todayKey]?.bytes ?? 0, total, requests };
}
