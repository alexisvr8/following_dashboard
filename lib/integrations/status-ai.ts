import { aiEnabled, postMeetingModel } from "@/lib/llm/postmeeting";
import { generateStatusMail } from "@/lib/llm/status-mail";
import { setStatusAI, type ClientRecord, type ClientsFile } from "@/lib/store/clients-store";
import type { WorkSettings } from "@/lib/store/settings-store";
import { currentFollowupKind, statusAIRequest } from "@/lib/utils/followup";

// Mail de seguimiento redactado con IA: para cada cuenta asignada cuyo mail vigente es el de seguimiento
// (`status`, la minuta ya salió) y cuya entrada cambió (tildaste algo, llegó un mail, nuevo análisis), pide a
// Claude la redacción y la guarda en `client.statusAI`. `buildStatusUpdate` la usa mientras la huella coincida.
// En la sync: máx. 3 por corrida. Desde "Actualizar" del composer: la cuenta pedida, al momento.

const PER_RUN = 3;
/** En la sync: no redactar mientras seguís tildando (últimos 20 min) ni más de una vez cada 3 h por cuenta. */
const SETTLE_MS = 20 * 60_000;
const MIN_GAP_MS = 3 * 3_600_000;

const latestMeeting = (c: ClientRecord) => [...c.meetings].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;

export async function generateStatusMails(
  file: ClientsFile,
  settings: WorkSettings,
  /** `force` (botón Actualizar): ignora la espera y el intervalo mínimo. */
  opts: { ids?: string[]; max?: number; force?: boolean } = {},
): Promise<{ generated: number; failed: number }> {
  if (!aiEnabled()) return { generated: 0, failed: 0 };
  const wanted = opts.ids && new Set(opts.ids);
  const todo = file.clients
    .filter((c) => c.status === "assigned" && (!wanted || wanted.has(c.id)))
    .flatMap((client) => {
      const meeting = latestMeeting(client);
      if (!meeting || currentFollowupKind(client, meeting) !== "status") return [];
      const req = statusAIRequest(client, meeting, file.ownerEmail ?? null, settings);
      if (!req.worth || client.statusAI?.key === req.key) return [];
      if (!opts.force) {
        const now = Date.now();
        if (client.ticketsUpdatedAt && now - Date.parse(client.ticketsUpdatedAt) < SETTLE_MS) return [];
        if (client.statusAI && now - Date.parse(client.statusAI.generatedAt) < MIN_GAP_MS) return [];
      }
      return [{ client, meeting, req }];
    })
    .slice(0, opts.max ?? PER_RUN);

  let generated = 0;
  let failed = 0;
  for (const { client, meeting, req } of todo) {
    try {
      const out = await generateStatusMail(req.input);
      const refs = new Set(req.input.sections.flatMap((s) => s.items.map((i) => i.ref)));
      await setStatusAI(client.id, {
        meetingId: meeting.id,
        key: req.key,
        generatedAt: new Date().toISOString(),
        model: postMeetingModel(),
        apertura: out.apertura.trim(),
        items: Object.fromEntries(out.items.filter((i) => refs.has(i.ref) && i.texto.trim()).map((i) => [i.ref, i.texto.trim()])),
        cierre: out.cierre.trim(),
        revision: out.revision,
      });
      generated++;
    } catch {
      failed++;
    }
  }
  return { generated, failed };
}
