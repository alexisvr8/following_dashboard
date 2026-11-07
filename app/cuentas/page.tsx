import Link from "next/link";
import { Mail } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChurnRiskBadge } from "@/components/dashboard/ChurnRiskBadge";
import { AccountDirectory, type DirectoryRow } from "@/components/cuentas/AccountDirectory";
import { AccountWorkspace } from "@/components/cuentas/AccountWorkspace";
import { AccountProfileForm } from "@/components/cuentas/AccountProfileForm";
import { ParticipantsList } from "@/components/cuentas/ParticipantsList";
import { ActivityPanel } from "@/components/cuentas/ActivityPanel";
import { FollowupComposer } from "@/components/cuentas/FollowupComposer";
import { MeetingsList } from "@/components/cuentas/MeetingsList";
import { getClientsFile } from "@/lib/store/clients-store";
import { getSettings } from "@/lib/store/settings-store";
import { clientsToBoard } from "@/lib/utils/clients-to-board";
import { getLatestMeeting } from "@/lib/utils/meetings";
import { byMovement } from "@/lib/utils/movement";
import { loadAccountView } from "@/lib/server/account-view";

export const dynamic = "force-dynamic";

// Cuentas en 3 columnas: directorio (izq.) · encabezado + borradores (centro) · contexto operativo en
// pestañas (der.). En escritorio entra en una pantalla con scroll por columna; en móvil se apila.
export default async function CuentasPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; tab?: string; borrador?: string }>;
}) {
  const { id, tab, borrador } = await searchParams;
  const settings = await getSettings();
  const file = await getClientsFile();
  const validated = file.clients.filter((c) => c.status === "assigned" || c.status === "unassigned");
  const { accounts, meetings, tickets } = clientsToBoard(validated, new Date(), file.ownerEmail ?? null);

  const rows: DirectoryRow[] = accounts.map((account) => {
    const latest = getLatestMeeting(account.id, meetings);
    const own = tickets.filter((t) => t.accountId === account.id);
    return {
      account,
      latestMeeting: latest && { date: latest.meetingDate, durationMinutes: latest.durationMinutes ?? null },
      meetingCount: meetings.filter((m) => m.accountId === account.id).length,
      actionablesDefined: own.length,
      pendingActionables: own.filter((t) => !t.isDone).length,
    };
  });

  const requested = id ? validated.find((c) => c.id === decodeURIComponent(id)) : undefined;
  const currentTab: "assigned" | "unassigned" =
    tab === "unassigned" || (!tab && requested?.status === "unassigned") ? "unassigned" : "assigned";
  const firstInTab = accounts
    .filter((a) => a.isAssigned === (currentTab === "assigned"))
    .sort(byMovement)[0];
  const client = requested ?? (firstInTab ? validated.find((c) => c.id === firstInTab.id) : undefined);

  if (!accounts.length) {
    return (
      <div className="mx-auto max-w-[1440px] px-4 py-6 md:px-6 lg:px-10">
        <div className="rounded-lg border border-dashed border-divider p-8 text-center text-sm text-muted-foreground">
          Todavía no hay clientes validados.{" "}
          <Link href="/clientes" className="font-medium text-foreground-strong underline-offset-4 hover:underline">
            Escanea y valida tus clientes
          </Link>
          .
        </div>
      </div>
    );
  }

  return (
    <div className="grid w-full grid-cols-1 gap-4 p-4 lg:h-[calc(100dvh-3.6rem)] lg:grid-cols-[320px_minmax(0,1fr)_360px] 2xl:grid-cols-[360px_minmax(0,1fr)_420px]">
      <AccountDirectory rows={rows} selectedId={client?.id ?? null} tab={currentTab} />
      {client ? (
        <Workspace key={client.id} clientId={client.id} borrador={borrador} file={file} settings={settings} />
      ) : (
        <p className="rounded-lg border border-dashed border-divider p-6 text-center text-sm text-muted-foreground lg:col-span-2">
          Elegí una cuenta.
        </p>
      )}
    </div>
  );
}

function Workspace({
  clientId,
  borrador,
  file,
  settings,
}: {
  clientId: string;
  borrador?: string;
  file: Awaited<ReturnType<typeof getClientsFile>>;
  settings: Awaited<ReturnType<typeof getSettings>>;
}) {
  const client = file.clients.find((c) => c.id === clientId)!;
  const v = loadAccountView(file, client, settings);
  const { latest, meetingDraft, statusDraft, alert } = v;
  const enc = encodeURIComponent(client.id);
  const threads = client.activity?.threads ?? [];

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
    latest && meetingDraft && statusDraft ? (
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
        {/* Un solo editor con selector de vista; con alerta o ?borrador=status abre en seguimiento. */}
        <Tabs defaultValue={borrador === "status" || alert ? "status" : "meeting"}>
          <TabsList className="w-full sm:w-fit">
            <TabsTrigger value="meeting">Mail post-reunión</TabsTrigger>
            <TabsTrigger value="status">Mail de seguimiento</TabsTrigger>
          </TabsList>
          <TabsContent value="meeting" keepMounted>
          <FollowupComposer
            key={`m-${latest.id}`}
            kind="meeting"
            className="lg:h-auto"
            fitViewport
            clientId={client.id}
            title="Mail post-reunión"
            hint={
              meetingDraft.regenerated
                ? `Regenerado con los mails y accionables nuevos, a partir de la minuta de “${latest.title}”.`
                : `Accionables de la minuta de “${latest.title}”, al día con mails y lo marcado como realizado.`
            }
            lastSentAt={meetingDraft.lastSentAt}
            initial={meetingDraft.draft}
            generated={meetingDraft.generated}
            threads={threads}
          />
          </TabsContent>
          <TabsContent value="status" keepMounted>
          <FollowupComposer
            key={`s-${latest.id}`}
            kind="status"
            className="lg:h-auto"
            fitViewport
            clientId={client.id}
            title="Mail de seguimiento"
            hint={
              statusDraft.regenerated
                ? `Regenerado porque cambiaron los accionables o llegó un mail nuevo después de tu última edición. Parte de ${v.statusSource}.`
                : `Parte de ${v.statusSource}, con los accionables finalizados desde tu último mail y lo que falta. Se actualiza con cada mail o accionable.`
            }
            lastSentAt={statusDraft.lastSentAt}
            initial={statusDraft.draft}
            generated={statusDraft.generated}
            threads={threads}
          />
          </TabsContent>
        </Tabs>
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
    />
  );
}
