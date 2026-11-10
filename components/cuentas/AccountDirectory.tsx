"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Badge, StatusDot } from "@/components/ui/badge";
import { computeChurnRisk } from "@/lib/utils/churn";
import { inputClass } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChurnRiskBadge } from "@/components/dashboard/ChurnRiskBadge";
import { daysAgo, formatMinutes, formatShortDate } from "@/lib/utils/format";
import { cn } from "@/lib/utils";
import { byMovement, movementBucket } from "@/lib/utils/movement";
import type { Account } from "@/types/account";

export type DirectoryRow = {
  account: Account;
  latestMeeting: { date: string; durationMinutes: number | null } | null;
  meetingCount: number;
  actionablesDefined: number;
  pendingActionables: number;
};

type Tab = "assigned" | "unassigned";
const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

type RiskFilter = "all" | "red" | "yellow";
const RISK_FILTERS: { value: RiskFilter; label: string; tone?: "critical" | "warning" }[] = [
  { value: "all", label: "Todas" },
  { value: "red", label: "En riesgo", tone: "critical" },
  { value: "yellow", label: "Atención", tone: "warning" },
];

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const sortRows = (rows: DirectoryRow[]) => rows.slice().sort((a, b) => byMovement(a.account, b.account));

// Directorio compacto de cuentas: tabs Asignadas/No asignadas, buscador por nombre/dominio/ERP y
// títulos Hoy/Ayer/Esta semana/Anteriores según el último movimiento.
// Vive en el layout de /cuentas: la cuenta abierta sale de la URL (`/cuentas/[id]`), así la selección
// se marca apenas se hace click, sin esperar al servidor.
export function AccountDirectory({ rows }: { rows: DirectoryRow[] }) {
  const params = useParams<{ id?: string }>();
  const selectedId = params.id ? safeDecode(params.id) : null;
  const tabOf = (id: string | null): Tab =>
    rows.find((r) => r.account.id === id)?.account.isAssigned === false ? "unassigned" : "assigned";
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState<Tab>(() => tabOf(selectedId));
  // Si se abre una cuenta de la otra pestaña (link externo, alerta), el directorio la sigue.
  const [lastSelected, setLastSelected] = useState(selectedId);
  if (lastSelected !== selectedId) {
    setLastSelected(selectedId);
    setCurrent(tabOf(selectedId));
  }
  const q = norm(query.trim());
  const visible = sortRows(q ? rows.filter((r) => norm(`${r.account.name} ${r.account.id} ${r.account.erp ?? ""}`).includes(q)) : rows);
  const assigned = visible.filter((r) => r.account.isAssigned);
  const unassigned = visible.filter((r) => !r.account.isAssigned);
  const inTab = current === "assigned" ? assigned : unassigned;
  const [risk, setRisk] = useState<RiskFilter>("all");
  const riskOf = (r: DirectoryRow) => computeChurnRisk(r.account.lastActivityAt);
  const counts = { all: inTab.length, red: 0, yellow: 0 };
  for (const r of inTab) {
    const level = riskOf(r);
    if (level === "red" || level === "yellow") counts[level]++;
  }
  const list = risk === "all" ? inTab : inTab.filter((r) => riskOf(r) === risk);
  const now = new Date();

  return (
    <div className="flex min-h-0 flex-col gap-2.5 rounded-xl border border-border bg-surface p-3">
      <Tabs value={current} onValueChange={(v) => setCurrent(v as Tab)}>
        <TabsList className="w-full">
          <TabsTrigger value="assigned">
            Asignadas <span className="tabular text-[11px]">{assigned.length}</span>
          </TabsTrigger>
          <TabsTrigger value="unassigned">
            No asignadas <span className="tabular text-[11px]">{unassigned.length}</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div role="group" aria-label="Filtrar por estado" className="grid shrink-0 grid-cols-3 gap-1">
        {RISK_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={risk === f.value}
            onClick={() => setRisk(f.value)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
              risk === f.value
                ? "border-border-strong bg-accent text-foreground-strong"
                : "border-border text-muted-foreground hover:bg-card hover:text-foreground",
            )}
          >
            {f.tone && <StatusDot tone={f.tone} />}
            {f.label}
            <span className="tabular text-[11px] text-subtle-foreground">{counts[f.value]}</span>
          </button>
        ))}
      </div>
      <div className="relative shrink-0">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar cuenta, dominio o ERP…"
          aria-label="Buscar cuenta"
          className={cn(inputClass, "h-8 pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden")}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Limpiar búsqueda"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-subtle-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <nav aria-label="Cuentas" className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 [scrollbar-width:thin] max-lg:max-h-[45dvh]">
        {!list.length && (
          <p className="rounded-lg border border-dashed border-divider p-4 text-center text-xs text-muted-foreground">
            {q ? `Ninguna cuenta coincide con “${query}”.` : risk !== "all" ? "Ninguna cuenta con ese estado." : "Sin cuentas."}
          </p>
        )}
        <ul className="space-y-1.5">
          {list.map((row, i) => {
            const bucket = movementBucket(row.account.lastMovementAt, now);
            const isNew = !q && (i === 0 || movementBucket(list[i - 1].account.lastMovementAt, now) !== bucket);
            return (
              <li key={row.account.id}>
                {isNew && (
                  // Título de grupo (Hoy / Ayer / Esta semana / Anteriores): más grande y con línea guía.
                  <h3 className={cn("flex items-center gap-2 px-1 pb-2 text-[13px] font-semibold text-foreground-strong", i === 0 ? "pt-1" : "pt-4")}>
                    {bucket}
                    <span aria-hidden className="h-px flex-1 bg-divider" />
                  </h3>
                )}
                <Row row={row} active={row.account.id === selectedId} />
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

function Row({ row, active }: { row: DirectoryRow; active: boolean }) {
  const { account: a, latestMeeting } = row;
  return (
    <Link
      href={`/cuentas/${encodeURIComponent(a.id)}`}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={cn(
        // Card con micro-borde; seleccionada: borde más claro, superficie elevada y barra fina a la izquierda.
        "relative block space-y-2.5 overflow-hidden rounded-lg border px-4 py-4 outline-none transition-colors duration-150 focus-visible:border-ring",
        "before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-foreground-strong before:opacity-0 before:transition-opacity",
        active
          ? "border-border-strong bg-accent shadow-highlight before:opacity-100"
          : "border-border bg-card hover:border-border-strong hover:bg-accent/40",
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn("min-w-0 flex-1 truncate text-[15px] font-medium leading-snug", active && "text-foreground-strong")}>{a.name}</span>
        <ChurnRiskBadge lastActivityAt={a.lastActivityAt} size="sm" />
      </div>
      <p className="flex gap-1 text-xs text-muted-foreground" title={a.lastMovementLabel ?? undefined}>
        {a.lastMovementAt ? (
          <>
            <span className="min-w-0 truncate">{a.lastMovementLabel}</span>
            <span className="shrink-0 tabular">· {daysAgo(a.lastMovementAt)}</span>
          </>
        ) : (
          "Sin movimientos"
        )}
      </p>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-label-sm text-subtle-foreground">
        <span title="Accionables pendientes / definidos en la última reunión">
          <b className="font-medium text-muted-foreground">
            {row.actionablesDefined ? `${row.pendingActionables}/${row.actionablesDefined}` : "0"}
          </b>{" "}
          pend.
        </span>
        <span title="Referentes">{a.referentCount ?? 0} ref.</span>
        {latestMeeting && (
          <span title="Última reunión">
            {formatShortDate(latestMeeting.date)} · {formatMinutes(latestMeeting.durationMinutes)}
          </span>
        )}
        <span title="Reuniones en 60 días · minutos en 30 días">
          {row.meetingCount} reun. · {formatMinutes(a.calendarMinutesPlanned)}/30d
        </span>
        {a.erp && (
          <Badge variant="outline" className="ml-auto h-4 px-1 text-[10px]">
            {a.erp}
          </Badge>
        )}
      </div>
    </Link>
  );
}
