import { notFound } from "next/navigation";
import { Mail } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChurnRiskBadge } from "@/components/dashboard/ChurnRiskBadge";
import { AccountWorkspace } from "@/components/cuentas/AccountWorkspace";
import { AnalysisPanel } from "@/components/cuentas/AnalysisPanel";
import { analysisView } from "@/lib/utils/account-analysis";
import { AccountProfileForm } from "@/components/cuentas/AccountProfileForm";
import { AttentionBadge, AttentionToggle } from "@/components/cuentas/AttentionToggle";
import { ParticipantsList } from "@/components/cuentas/ParticipantsList";
import { ActivityPanel } from "@/components/cuentas/ActivityPanel";
import { FollowupComposer } from "@/components/cuentas/FollowupComposer";
import { MeetingsList } from "@/components/cuentas/MeetingsList";
import type { ClientRecord, ClientsFile } from "@/lib/store/clients-store";
import type { WorkSettings } from "@/lib/store/settings-store";
import { loadAccountView } from "@/lib/server/account-view";
import { getClientCached, getSettingsCached } from "@/lib/server/cached-data";
import { composerThreads } from "@/lib/utils/followup-thread";

export const dynamic = "force-dynamic";

// Detalle de una cuenta (centro + der.). El directorio vive en `app/cuentas/layout.tsx` y no se vuelve
// a pedir al cambiar de cuenta: acá solo se lee la fila de esta cuenta.
export default async function CuentaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params; // `?borrador=` de links viejos: ya hay un solo mail, se ignora.
  const [{ client, ownerEmail }, settings] = await Promise.all([
    getClientCached(decodeURIComponent(id)),
    getSettingsCached(),
  ]);
  if (!client || (client.status !== "assigned" && client.status !== "unassigned")) notFound();
  // `loadAccountView` solo usa `ownerEmail` del archivo.
  const file: ClientsFile = { clients: [client], unmatched: [], lastScanAt: null, ownerEmail };
  return <Workspace key={client.id} client={client} file={file} settings={settings} />;
}

function Workspace({
  client,
  file,
  settings,
}: {
  client: ClientRecord;
  file: ClientsFile;
  settings: WorkSettings;
}) {
  const v = loadAccountView(file, client, settings);
  const { latest, followup, alert } = v;
  const enc = encodeURIComponent(client.id);
  const threads = composerThreads(client); // hilo fijado primero

  const header = (
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
      contacts={v.contacts}
      header={
        <div className="min-w-0 flex-1 basis-72 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-semibold text-foreground-strong">{client.name}</h1>
            <ChurnRiskBadge lastActivityAt={v.account.lastActivityAt} />
            {client.profile?.attention && <AttentionBadge />}
            {client.profile?.erp && <Badge variant="outline">ERP {client.profile.erp}</Badge>}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            <span className="tabular">{client.domain}</span>
            {" · "}
            {v.referents.length
              ? `Referentes: ${v.referents.map((p) => p.customName ?? p.name ?? p.email).join(", ")}`
              : "Sin referentes"}
          </p>
        </div>
      }
      actions={
        <>
          {client.status === "assigned" && <AttentionToggle clientId={client.id} initial={Boolean(client.profile?.attention)} />}
          <a
            href={`/api/clients/${enc}/last-mail`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Mail /> Último mail en Gmail
          </a>
        </>
      }
    />
  );

  const drafts =
    latest && followup ? (
      <section id="borradores" className="flex flex-col gap-3 scroll-mt-20">
        {alert && (
          <p className="rounded-md border border-warning/25 bg-warning-muted px-3 py-1.5 text-xs">
            {alert.kind === "client_waiting"
              ? `El cliente espera respuesta hace ${alert.businessDays} día(s) hábil(es).`
              : alert.kind === "awaiting_client"
                ? `Sin respuesta del cliente hace ${alert.businessDays} día(s) hábil(es): conviene un seguimiento.`
                : `Sin avances comunicados hace ${alert.businessDays} día(s) hábil(es).`}{" "}
            Último movimiento: {alert.lastMovementLabel}.
          </p>
        )}
        {/* Un solo mail de seguimiento: post-reunión hasta que sale (con lo tildado como hecho), después
            avances desde la reunión / mi último mail + lo que queda (`currentFollowupKind`). */}
        <FollowupComposer
          key={`${followup.kind}-${latest.id}`}
          kind={followup.kind}
          showTitle
          className="lg:h-auto"
          fitViewport
          clientId={client.id}
          title="Mail de seguimiento"
          hint={
            followup.kind === "meeting"
              ? followup.regenerated
                ? `Resumen de “${latest.title}”, regenerado con los mails y accionables nuevos. Al enviarlo, pasa a mail de avances.`
                : `Resumen de “${latest.title}” con cada accionable en su estado (lo que marcás como hecho se actualiza). Al enviarlo, pasa a mail de avances.`
              : followup.regenerated
                ? `Regenerado porque cambiaron los accionables o llegó un mail nuevo. Parte de ${v.statusSource}.`
                : `Avances desde ${v.statusSource} y lo que queda pendiente. Se actualiza con cada mail o accionable.`
          }
          lastSentAt={followup.lastSentAt}
          initial={followup.draft}
          generated={followup.generated}
          threads={threads}
        />
      </section>
    ) : (
      <p className="rounded-lg border border-dashed border-divider p-6 text-center text-sm text-muted-foreground">
        Sin reuniones: todavía no hay borradores para esta cuenta.
      </p>
    );

  return (
    <AccountWorkspace
      header={header}
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
      tickets={v.tickets}
      history={v.history}
      chain={v.chain}
      totalMeetings={v.meetings.length}
      minutes30d={v.account.calendarMinutesPlanned}
      participantCount={v.participants.length}
      drafts={drafts}
      trace={
        <ActivityPanel
          clientId={client.id}
          activity={client.activity ?? null}
          latestMinutesDate={latest?.date ?? null}
          ticketTitles={v.ticketTitles}
        />
      }
      participants={<ParticipantsList clientId={client.id} participants={v.participants} />}
      meetingHistory={<MeetingsList meetings={v.meetings} />}
      analysis={client.status === "assigned" ? <AnalysisPanel clientId={client.id} view={analysisView(client)} /> : null}
    />
  );
}
