import Link from "next/link";
import { AccountDirectory, type DirectoryRow } from "@/components/cuentas/AccountDirectory";
import { clientsToBoard } from "@/lib/utils/clients-to-board";
import { getLatestMeeting } from "@/lib/utils/meetings";
import { getClientsFileCached } from "@/lib/server/cached-data";

// Cuentas en 3 columnas: directorio (izq., este layout) · detalle de la cuenta (`[id]/page.tsx`, centro + der.).
// Un layout no se vuelve a renderizar al navegar entre sus hijos: cambiar de cuenta solo pide el detalle.
// En escritorio entra en una pantalla con scroll por columna; en móvil se apila.
export default async function CuentasLayout({ children }: { children: React.ReactNode }) {
  const file = await getClientsFileCached();
  const validated = file.clients.filter((c) => c.status === "assigned" || c.status === "unassigned");
  const { accounts, meetings, tickets } = clientsToBoard(validated, new Date(), file.ownerEmail ?? null);

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

  const rows: DirectoryRow[] = accounts.map((account) => {
    const latest = getLatestMeeting(account.id, meetings);
    const own = tickets.filter((t) => t.accountId === account.id);
    return {
      account,
      latestMeeting: latest && { date: latest.meetingDate, durationMinutes: latest.durationMinutes ?? null },
      meetingCount: meetings.filter((m) => m.accountId === account.id).length,
      actionablesDefined: own.length,
      pendingActionables: own.filter((t) => !t.isDone).length,
      attention: Boolean(validated.find((c) => c.id === account.id)?.profile?.attention),
    };
  });

  return (
    <div className="grid w-full grid-cols-1 gap-4 p-4 lg:h-[calc(100dvh-3.6rem)] lg:grid-cols-[320px_minmax(0,1fr)_360px] 2xl:grid-cols-[360px_minmax(0,1fr)_420px]">
      <AccountDirectory rows={rows} />
      {children}
    </div>
  );
}
