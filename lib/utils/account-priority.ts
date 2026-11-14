import type { ClientRecord } from "@/lib/store/clients-store";
import type { Level } from "@/lib/llm/account-analysis-schema";

// Prioridad de la cuenta: la manual (`profile.priority`) manda; si no hay, la que sugirió el análisis semanal
// con IA (engagement + complejidad); sin ninguna, "media". Ordena el tablero y sube la prioridad de los
// accionables de las cuentas "alta".

export type AccountPrioritySource = "atencion" | "manual" | "ia" | "default";

export interface AccountPriority {
  level: Level;
  source: AccountPrioritySource;
  /** Motivo de la IA (si la sugirió). */
  reason: string | null;
}

export const ACCOUNT_PRIORITY_RANK: Record<Level, number> = { alta: 0, media: 1, baja: 2 };

export function accountPriority(client: Pick<ClientRecord, "profile" | "analysis">): AccountPriority {
  const ai = client.analysis?.output.prioridad ?? null;
  if (client.profile?.attention) return { level: "alta", source: "atencion", reason: "Cuenta marcada de más atención" };
  if (client.profile?.priority) return { level: client.profile.priority, source: "manual", reason: ai?.motivo ?? null };
  if (ai) return { level: ai.nivel, source: "ia", reason: ai.motivo };
  return { level: "media", source: "default", reason: null };
}
