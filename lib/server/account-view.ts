import type { ClientRecord, ClientsFile } from "@/lib/store/clients-store";
import type { WorkSettings } from "@/lib/store/settings-store";
import { getDraft, latestInteraction } from "@/lib/utils/followup";
import { computeAlerts } from "@/lib/utils/followup-alerts";
import { clientsToBoard } from "@/lib/utils/clients-to-board";
import { executedHistory } from "@/lib/utils/actionables";
import { computeParticipants } from "@/lib/utils/participants";

/** Todo lo que necesita el espacio de trabajo de una cuenta (columnas central y derecha de /cuentas). */
export function loadAccountView(file: ClientsFile, client: ClientRecord, settings: WorkSettings) {
  const { accounts, tickets } = clientsToBoard([client], new Date(), file.ownerEmail ?? null);
  const account = accounts[0];
  const participants = computeParticipants(client, file.ownerEmail);
  const meetings = [...client.meetings].sort((a, b) => b.date.localeCompare(a.date));
  const latest = meetings[0] ?? null;
  const owner = file.ownerEmail ?? null;
  const meetingDraft = latest ? getDraft("meeting", client, latest, owner, settings) : null;
  const statusDraft = latest ? getDraft("status", client, latest, owner, settings) : null;
  const interaction = latest ? latestInteraction(client, latest) : null;
  const statusSource =
    interaction?.kind === "mail"
      ? `${interaction.mail.direction === "me" ? "tu último mail" : `el último mail de ${interaction.mail.fromName ?? interaction.mail.from}`} (“${interaction.mail.subject}”)`
      : "la última reunión";
  const alert = computeAlerts([client], settings)[0] ?? null;
  const ticketTitles = Object.fromEntries(tickets.map((t) => [t.id, t.title]));
  const current = new Set(tickets.map((t) => t.id));
  const history = executedHistory(client).filter((h) => !current.has(h.id));
  const recentMails = client.activity?.recentMails ?? [];
  const chain = recentMails
    .filter((m) => !latest || Date.parse(m.date) > Date.parse(latest.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  // A quién se le puede escribir: referentes, quienes escribieron y los destinatarios de los borradores.
  const senders = new Map(recentMails.filter((m) => m.direction === "client").map((m) => [m.from, m.fromName]));
  const contactEmails = new Set([
    ...participants.filter((p) => p.role === "referent").map((p) => p.email),
    ...senders.keys(),
    ...(meetingDraft?.draft.to ?? []),
    ...(statusDraft?.draft.to ?? []),
  ]);
  const contacts = [...contactEmails].map((email) => {
    const name = participants.find((p) => p.email === email)?.name ?? senders.get(email) ?? null;
    return { email, detectedName: name?.includes("@") ? null : name };
  });
  const referents = participants.filter((p) => p.role === "referent");

  return {
    account,
    tickets,
    participants,
    referents,
    meetings,
    latest,
    meetingDraft,
    statusDraft,
    statusSource,
    alert,
    ticketTitles,
    history,
    chain,
    contacts,
  };
}
