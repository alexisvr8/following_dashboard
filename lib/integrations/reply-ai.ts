import { aiEnabled, statusMailModel } from "@/lib/llm/postmeeting";
import { generateClientMail, type ClientMailMode } from "@/lib/llm/reply-mail";
import { getClientsFile, setReplyAI, setTicketDone, type ClientRecord, type ClientsFile } from "@/lib/store/clients-store";
import type { WorkSettings } from "@/lib/store/settings-store";
import { clientMailRequest } from "@/lib/utils/followup";

// Respuesta (`reply`) y Pedir status (`reminder`) redactados con IA (modelo barato), en la voz del PM. Solo bajo
// demanda: al abrir esa pestaña en el panel o con Actualizar del composer. Si la entrada no cambió, se reusa.
// Lo que el cliente confirmó como hecho en sus mails (`resueltos`) se tilda solo y queda avisado en el borrador.

const latestMeeting = (c: ClientRecord) => [...c.meetings].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;

export async function generateClientMailAI(
  file: ClientsFile,
  settings: WorkSettings,
  clientId: string,
  mode: ClientMailMode,
): Promise<"generated" | "cached" | "skipped" | "failed"> {
  if (!aiEnabled()) return "skipped";
  const client = file.clients.find((c) => c.id === clientId && c.status === "assigned");
  const meeting = client && latestMeeting(client);
  if (!client || !meeting) return "skipped";
  const owner = file.ownerEmail ?? null;
  const req = clientMailRequest(mode, client, meeting, owner, settings);
  if (!req.worth) return "skipped";
  const saved = mode === "reply" ? client.replyAI : client.reminderAI;
  if (saved?.key === req.key) return "cached";
  try {
    const out = await generateClientMail(req.input, {
      clientId: client.id,
      clientName: client.name,
      trigger: mode === "reply" ? "responder" : "pedir-status",
    });
    // Tildar lo que el cliente dio por hecho (el texto ya lo agradece/confirma).
    const texts = new Map([...req.input.openOwn, ...req.input.openClient].map((i) => [i.ref, i.text]));
    const resolved = out.resueltos
      .filter((r) => req.refs.has(r.ref))
      .map((r) => ({ ticketId: req.refs.get(r.ref)!, text: texts.get(r.ref) ?? r.ref, motivo: r.motivo.trim() }));
    for (const r of resolved) await setTicketDone(client.id, r.ticketId, true);
    // La huella se calcula con el estado ya tildado: es el que va a ver el borrador.
    let key = req.key;
    if (resolved.length) {
      const fresh = (await getClientsFile()).clients.find((c) => c.id === client.id) ?? client;
      key = clientMailRequest(mode, fresh, meeting, owner, settings).key;
    }
    await setReplyAI(
      client.id,
      {
        key,
        generatedAt: new Date().toISOString(),
        model: statusMailModel(),
        cuerpo: out.cuerpo.trim(),
        revision: out.revision,
        ...(resolved.length && { resolved }),
      },
      mode,
    );
    return "generated";
  } catch {
    return "failed";
  }
}

/** Compatibilidad: respuesta. */
export const generateReplyAI = (file: ClientsFile, settings: WorkSettings, clientId: string) =>
  generateClientMailAI(file, settings, clientId, "reply");
