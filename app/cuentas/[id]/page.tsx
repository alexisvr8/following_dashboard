import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, KanbanSquare, Mail } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChurnRiskBadge } from "@/components/dashboard/ChurnRiskBadge";
import { LastMeetingPanel } from "@/components/cuentas/LastMeetingPanel";
import { AccountProfileForm } from "@/components/cuentas/AccountProfileForm";
import { ParticipantsList } from "@/components/cuentas/ParticipantsList";
import { ActivityPanel } from "@/components/cuentas/ActivityPanel";
import { FollowupComposer } from "@/components/cuentas/FollowupComposer";
import { getDraft } from "@/lib/utils/followup";
import { getSettings } from "@/lib/store/settings-store";
import { computeAlerts } from "@/lib/utils/followup-alerts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getClientsFile } from "@/lib/store/clients-store";
import { clientsToBoard } from "@/lib/utils/clients-to-board";
import { computeParticipants } from "@/lib/utils/participants";
import { TRACKING_COLUMNS } from "@/lib/tracking";
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
  const stage = TRACKING_COLUMNS.find((c) => c.status === account.trackingStatus)?.label;
  const enc = encodeURIComponent(client.id);
  const owner = file.ownerEmail ?? null;
  const meetingDraft = latest ? getDraft("meeting", client, latest, owner, settings) : null;
  const statusDraft = latest ? getDraft("status", client, latest, owner, settings) : null;
  const alert = computeAlerts([client], settings)[0];
  const defaultTab = borrador === "status" || alert ? "status" : "meeting";
  const ticketTitles = Object.fromEntries(tickets.map((t) => [t.id, t.title]));

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <Link href="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Dashboard
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{client.name}</h1>
            <ChurnRiskBadge lastActivityAt={account.lastActivityAt} />
          </div>
          <p className="text-sm text-muted-foreground">
            {client.domain}
            {client.profile?.erp && ` · ERP ${client.profile.erp}`}
            {stage && client.status === "assigned" && ` · ${stage}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <LastMeetingPanel
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
            totalMeetings={meetings.length}
            minutes30d={account.calendarMinutesPlanned}
            clientId={client.id}
          />

          {latest && meetingDraft && statusDraft && (
            <section id="borradores" className="scroll-mt-20 space-y-2">
              {alert && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                  {alert.kind === "client_waiting"
                    ? `El cliente espera respuesta hace ${alert.businessDays} día(s) hábil(es).`
                    : alert.kind === "awaiting_client"
                      ? `Sin respuesta del cliente hace ${alert.businessDays} día(s) hábil(es): conviene un seguimiento.`
                      : `Sin avances comunicados hace ${alert.businessDays} día(s) hábil(es).`}{" "}
                  Último movimiento: {alert.lastMovementLabel}.
                </p>
              )}
              <Tabs key={defaultTab} defaultValue={defaultTab}>
                <TabsList>
                  <TabsTrigger value="meeting">Follow-up de la reunión</TabsTrigger>
                  <TabsTrigger value="status">Actualización / seguimiento</TabsTrigger>
                </TabsList>
                <TabsContent value="meeting">
                  <FollowupComposer
                    key={`m-${latest.id}`}
                    kind="meeting"
                    clientId={client.id}
                    title="Follow-up de la reunión"
                    hint={`Generado de la minuta de “${latest.title}”.`}
                    initial={meetingDraft.draft}
                    generated={meetingDraft.generated}
                    threads={client.activity?.threads ?? []}
                  />
                </TabsContent>
                <TabsContent value="status">
                  <FollowupComposer
                    key={`s-${latest.id}-${client.ticketsUpdatedAt ?? ""}-${client.activity?.lastMail?.date ?? ""}`}
                    kind="status"
                    clientId={client.id}
                    title="Actualización de avance"
                    hint={
                      statusDraft.regenerated
                        ? "Regenerado porque cambiaron los accionables o llegó un mail nuevo después de tu última edición: incluye lo finalizado esta semana y lo que falta."
                        : "Generado con lo finalizado esta semana (con fecha), lo que falta (incluye lo arrastrado de semanas anteriores) y el último mail del cliente."
                    }
                    initial={statusDraft.draft}
                    generated={statusDraft.generated}
                    threads={client.activity?.threads ?? []}
                  />
                </TabsContent>
              </Tabs>
            </section>
          )}

          <ParticipantsList clientId={client.id} participants={participants} />

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
        </div>

        <aside className="space-y-6">
          <ActivityPanel
            clientId={client.id}
            activity={client.activity ?? null}
            latestMinutesDate={latest?.date ?? null}
            ticketTitles={ticketTitles}
          />
          <AccountProfileForm
            clientId={client.id}
            initial={{
              name: client.name,
              emailName: client.profile?.emailName ?? "",
              erp: client.profile?.erp ?? "",
              ownerEmail: client.profile?.ownerEmail ?? "",
              notes: client.profile?.notes ?? "",
            }}
            defaultOwnerEmail={file.ownerEmail ?? null}
          />
        </aside>
      </div>
    </div>
  );
}
