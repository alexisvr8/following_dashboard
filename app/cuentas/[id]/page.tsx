import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, KanbanSquare, Mail } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChurnRiskBadge } from "@/components/dashboard/ChurnRiskBadge";
import { AccountWorkspace } from "@/components/cuentas/AccountWorkspace";
import { AccountProfileForm } from "@/components/cuentas/AccountProfileForm";
import { ParticipantsList } from "@/components/cuentas/ParticipantsList";
import { ActivityPanel } from "@/components/cuentas/ActivityPanel";
import { FollowupComposer } from "@/components/cuentas/FollowupComposer";
import { getDraft, latestInteraction } from "@/lib/utils/followup";
import { getSettings } from "@/lib/store/settings-store";
import { computeAlerts } from "@/lib/utils/followup-alerts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getClientsFile } from "@/lib/store/clients-store";
import { clientsToBoard } from "@/lib/utils/clients-to-board";
import { executedHistory } from "@/lib/utils/actionables";
import { computeParticipants } from "@/lib/utils/participants";
import { daysAgo, formatMinutes, formatShortDate } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function CuentaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ borrador?: string }>;
}) {
  const { id } = await params;
  const { borrador } = await searchParams;
  const settings = await getSettings();
  const file = await getClientsFile();
  const client = file.clients.find((c) => c.id === decodeURIComponent(id));
  if (!client) notFound();

  const { accounts, tickets } = clientsToBoard([client], new Date(), file.ownerEmail ?? null);
  const account = accounts[0];
  const participants = computeParticipants(client, file.ownerEmail);
  const meetings = [...client.meetings].sort((a, b) => b.date.localeCompare(a.date));
  const latest = meetings[0] ?? null;
  const enc = encodeURIComponent(client.id);
  const owner = file.ownerEmail ?? null;
  const meetingDraft = latest ? getDraft("meeting", client, latest, owner, settings) : null;
  const statusDraft = latest ? getDraft("status", client, latest, owner, settings) : null;
  const interaction = latest ? latestInteraction(client, latest) : null;
  const statusSource =
    interaction?.kind === "mail"
      ? `${interaction.mail.direction === "me" ? "tu último mail" : `el último mail de ${interaction.mail.fromName ?? interaction.mail.from}`} (“${interaction.mail.subject}”)`
      : "la última reunión";
  const alert = computeAlerts([client], settings)[0];
  const defaultTab = borrador === "status" || alert ? "status" : "meeting";
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

  // En escritorio la página mide exactamente lo que queda bajo el header de la app (3.5rem + borde).
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-3 px-6 py-3 lg:h-[calc(100dvh-3.6rem)]">
      <AccountProfileForm
        clientId={client.id}
        initial={{
          name: client.name,
          emailName: client.profile?.emailName ?? "",
          erp: client.profile?.erp ?? "",
          ownerEmail: client.profile?.ownerEmail ?? "",
          notes: client.profile?.notes ?? "",
          contactNames: client.profile?.contactNames ?? {},
        }}
        defaultOwnerEmail={file.ownerEmail ?? null}
        contacts={contacts}
        header={
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              aria-label="Volver al Dashboard"
              title="Volver al Dashboard"
              className={buttonVariants({ variant: "ghost", size: "icon" })}
            >
              <ArrowLeft />
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-semibold tracking-tight">{client.name}</h1>
                <ChurnRiskBadge lastActivityAt={account.lastActivityAt} />
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {client.domain}
                {client.profile?.erp && ` · ERP ${client.profile.erp}`}
              </p>
            </div>
          </div>
        }
        actions={
          <>
            <a
              href={`/api/clients/${enc}/last-mail`}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline" })}
            >
              <Mail /> Último mail en Gmail
            </a>
            {client.status === "assigned" && (
              <Link href={`/tablero?open=${enc}`} className={buttonVariants()}>
                <KanbanSquare /> Ver card en Tablero
              </Link>
            )}
          </>
        }
      />

      <AccountWorkspace
        clientId={client.id}
        meeting={
          latest && {
            title: latest.title,
            date: latest.date,
            durationMinutes: latest.durationMinutes ?? null,
            summary: latest.summary,
            attendeeCount: latest.attendees?.length ?? 0,
          }
        }
        tickets={tickets}
        history={history}
        chain={chain}
        totalMeetings={meetings.length}
        minutes30d={account.calendarMinutesPlanned}
        participantCount={participants.length}
        drafts={
          latest && meetingDraft && statusDraft ? (
            <section id="borradores" className="flex min-h-0 flex-1 flex-col gap-2 scroll-mt-20">
              {alert && (
                <p className="shrink-0 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs">
                  {alert.kind === "client_waiting"
                    ? `El cliente espera respuesta hace ${alert.businessDays} día(s) hábil(es).`
                    : alert.kind === "awaiting_client"
                      ? `Sin respuesta del cliente hace ${alert.businessDays} día(s) hábil(es): conviene un seguimiento.`
                      : `Sin avances comunicados hace ${alert.businessDays} día(s) hábil(es).`}{" "}
                  Último movimiento: {alert.lastMovementLabel}.
                </p>
              )}
              <Tabs key={defaultTab} defaultValue={defaultTab} className="min-h-0 flex-1">
                <div className="shrink-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
                  <TabsList>
                    <TabsTrigger value="meeting">Follow-up de la reunión</TabsTrigger>
                    <TabsTrigger value="status">Actualización / seguimiento</TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="meeting" keepMounted className="min-h-0 p-px">
                  <FollowupComposer
                    key={`m-${latest.id}`}
                    kind="meeting"
                    clientId={client.id}
                    title="Follow-up de la reunión"
                    hint={
                      meetingDraft.regenerated
                        ? `Regenerado con los mails y accionables nuevos, a partir de la minuta de “${latest.title}”.`
                        : `Accionables de la minuta de “${latest.title}”, al día con mails y lo marcado como realizado.`
                    }
                    lastSentAt={meetingDraft.lastSentAt}
                    initial={meetingDraft.draft}
                    generated={meetingDraft.generated}
                    threads={client.activity?.threads ?? []}
                  />
                </TabsContent>
                <TabsContent value="status" keepMounted className="min-h-0 p-px">
                  <FollowupComposer
                    key={`s-${latest.id}`}
                    lastSentAt={statusDraft.lastSentAt}
                    kind="status"
                    clientId={client.id}
                    title="Actualización de avance"
                    hint={
                      statusDraft.regenerated
                        ? `Regenerado porque cambiaron los accionables o llegó un mail nuevo después de tu última edición. Parte de ${statusSource}.`
                        : `Parte de ${statusSource}, con lo avanzado en el tablero desde tu último mail y lo que falta. Se actualiza con cada mail o accionable.`
                    }
                    initial={statusDraft.draft}
                    generated={statusDraft.generated}
                    threads={client.activity?.threads ?? []}
                  />
                </TabsContent>
              </Tabs>
            </section>
          ) : (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Sin reuniones: todavía no hay borradores para esta cuenta.
            </p>
          )
        }
        trace={
          <ActivityPanel
            clientId={client.id}
            activity={client.activity ?? null}
            latestMinutesDate={latest?.date ?? null}
            ticketTitles={ticketTitles}
          />
        }
        participants={<ParticipantsList clientId={client.id} participants={participants} />}
        meetingHistory={
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Historial de reuniones</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {meetings.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{m.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{m.summary ?? "Sin resumen"}</p>
                    </div>
                    <div className="shrink-0 text-right text-xs text-muted-foreground">
                      <p>
                        {formatShortDate(m.date)} · {daysAgo(m.date)}
                      </p>
                      <p>
                        {formatMinutes(m.durationMinutes)} · {m.nextSteps.length} accionables
                        {m.attendees?.length ? ` · ${m.attendees.length} part.` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        }
      />
    </div>
  );
}
