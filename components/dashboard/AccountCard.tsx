import Link from "next/link";
import { CalendarClock, ChevronRight, ListChecks, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChurnRiskBadge } from "@/components/dashboard/ChurnRiskBadge";
import { daysAgo, formatMinutes, formatShortDate } from "@/lib/utils/format";
import type { Account } from "@/types/account";
import type { Meeting } from "@/types/meeting";

// Cara rápida de la cuenta: lo justo para decidir si hay que entrar. El detalle
// (engagement, participantes, perfil editable) vive en /cuentas/[id].
export function AccountCard({
  account,
  latestMeeting,
  meetingCount,
  actionablesDefined,
  pendingActionables,
}: {
  account: Account;
  latestMeeting: Meeting | null;
  meetingCount: number;
  actionablesDefined: number;
  pendingActionables: number;
}) {
  return (
    <Link
      href={`/cuentas/${encodeURIComponent(account.id)}`}
      className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="h-full transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md group-hover:ring-foreground/20">
        <CardHeader className="flex-row items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <CardTitle className="truncate text-base">{account.name}</CardTitle>
            <p className="truncate text-xs text-muted-foreground">
              {latestMeeting
                ? `${formatShortDate(latestMeeting.meetingDate)} · ${daysAgo(latestMeeting.meetingDate)}`
                : "Sin reuniones"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <ChurnRiskBadge lastActivityAt={account.lastActivityAt} />
            <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid grid-cols-3 gap-2 text-xs">
            <Stat icon={CalendarClock} label="Última reunión" value={formatMinutes(latestMeeting?.durationMinutes)} />
            <Stat
              icon={ListChecks}
              label="Accionables"
              value={actionablesDefined ? `${pendingActionables}/${actionablesDefined}` : "0"}
              hint={actionablesDefined ? "pendientes" : undefined}
            />
            <Stat icon={Users} label="Referentes" value={String(account.referentCount ?? 0)} />
          </dl>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>{meetingCount} reuniones (60d)</span>
            <span>·</span>
            <span>{formatMinutes(account.calendarMinutesPlanned)} en 30d</span>
            {account.erp && (
              <Badge variant="outline" className="ml-auto">
                ERP: {account.erp}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg bg-muted/50 px-2.5 py-2">
      <dt className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Icon className="size-3" />
        <span className="truncate">{label}</span>
      </dt>
      <dd className="mt-0.5 text-sm font-semibold">
        {value}
        {hint && <span className="ml-1 text-[10px] font-normal text-muted-foreground">{hint}</span>}
      </dd>
    </div>
  );
}
