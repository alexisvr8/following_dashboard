// Borrador REAL en Gmail de la minuta post-reunión con IA de una cuenta (última reunión con Doc), para validar.
// La IA se aplica en memoria (como `setMeetingAI`) y el mail sale de `buildFollowup`, en el hilo que elegiría la app.
// No guarda nada en la base: el borrador queda solo en Gmail (borralo después de revisarlo). Nunca envía.
// Uso: pnpm draft:postmeeting -- --id <id o nombre> [--json <salida.json> para reusar una generación, sin costo] [--out-dir <carpeta del JSON>] [--replace <draftId> actualiza ese borrador]
import { readFileSync, writeFileSync } from "node:fs";
import { google } from "googleapis";
import { getDocText } from "@/lib/integrations/drive";
import { createThreadDraft } from "@/lib/integrations/gmail";
import { getAuthorizedClient } from "@/lib/integrations/google-client";
import { buildPostMeetingInput } from "@/lib/integrations/meeting-ai";
import { generatePostMeeting, postMeetingModel } from "@/lib/llm/postmeeting";
import { PostMeetingSchema, type PostMeetingOutput } from "@/lib/llm/postmeeting-schema";
import { applyMeetingAI, getClientsFile } from "@/lib/store/clients-store";
import { getSettings } from "@/lib/store/settings-store";
import { buildFollowup } from "@/lib/utils/followup";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const norm = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function main() {
  const wanted = arg("id");
  if (!wanted) throw new Error("Pasá --id <cuenta>");
  const [file, settings] = await Promise.all([getClientsFile(), getSettings()]);
  const client = file.clients.find((c) => c.status === "assigned" && (c.id === wanted || norm(c.name).includes(norm(wanted))));
  if (!client) throw new Error(`No hay cuenta asignada que coincida con "${wanted}"`);
  const meeting = [...client.meetings].filter((m) => m.docId).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!meeting) throw new Error(`${client.name} no tiene reuniones con Doc`);
  const owner = file.ownerEmail ?? null;

  const input = buildPostMeetingInput(client, meeting, await getDocText(meeting.docId!), owner, settings);
  const out: PostMeetingOutput = arg("json")
    ? PostMeetingSchema.parse(JSON.parse(readFileSync(arg("json")!, "utf8")))
    : await generatePostMeeting(input, { clientId: client.id, clientName: client.name, trigger: "preview" });
  if (!arg("json")) writeFileSync(`${arg("out-dir") ?? "."}/${client.id.replace(/[^\w.-]/g, "_")}-postmeeting.json`, JSON.stringify(out, null, 2));

  // Como si la reunión nunca hubiera tenido IA: se aplica de cero en una copia.
  const copy = structuredClone(client);
  const m = copy.meetings.find((x) => x.id === meeting.id)!;
  m.nextSteps = meeting.ai?.geminiNextSteps ?? meeting.nextSteps;
  delete m.ai;
  const mode = applyMeetingAI(copy, meeting.id, out, postMeetingModel());
  const draft = buildFollowup(copy, m, owner, settings);

  console.log(`\n===== ${client.name} · reunión "${meeting.title}" (${meeting.date.slice(0, 10)}) · IA: ${String(mode)}`);
  console.log(`Trato: ${input.addressing?.plural ? "ustedes" : "tú"} (${input.addressing?.names.join(", ")})`);
  console.log(`Para: ${draft.to.join(", ")}${draft.cc?.length ? `\nCc: ${draft.cc.join(", ")}` : ""}\nAsunto: ${draft.subject}\nHilo: ${draft.threadId ?? "(nuevo)"} · ${draft.threadReason ?? ""}\n`);
  console.log(draft.body);
  if (draft.reviewNotes?.length) console.log(`\n[revisión]\n- ${draft.reviewNotes.join("\n- ")}`);

  const created = await createThreadDraft(
    { threadId: draft.threadId ?? null, to: draft.to, cc: draft.cc, subject: draft.subject, body: draft.body },
    arg("replace"),
  );
  // Comprobación: la firma quedó en el HTML del borrador.
  const auth = await getAuthorizedClient();
  const gmail = google.gmail({ version: "v1", auth: auth! });
  const { data } = await gmail.users.drafts.get({ userId: "me", id: created.draftId, format: "full" });
  const parts = data.message?.payload?.parts ?? [];
  const html = Buffer.from(parts.find((p) => p.mimeType === "text/html")?.body?.data ?? "", "base64").toString("utf8");
  const { data: sendAs } = await gmail.users.settings.sendAs.list({ userId: "me" });
  const sig = sendAs.sendAs?.find((s) => s.isPrimary)?.signature ?? "";
  console.log(`\nBorrador creado: ${created.draftId} · en hilo: ${Boolean(created.threadId && created.threadId === draft.threadId)} · firma en el HTML: ${sig ? html.includes(sig.trim().slice(0, 40)) : "sin firma configurada"}`);
  console.log(`Abrir: https://mail.google.com/mail/u/0/#drafts?compose=${data.message?.id}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
