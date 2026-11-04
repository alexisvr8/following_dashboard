import Link from "next/link";
import { TrackingBoard } from "@/components/tablero/TrackingBoard";
import { getClientsFile } from "@/lib/store/clients-store";
import { getSettings } from "@/lib/store/settings-store";
import { buildBoardCards } from "@/lib/utils/board-cards";
import { clientsToBoard } from "@/lib/utils/clients-to-board";

// Datos reales: clientes asignados en /clientes (descubiertos desde Gemini Notes),
// leídos de `.data/clients.json` en cada request.
export const dynamic = "force-dynamic";

export default async function TableroPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  const { open } = await searchParams;
  const { clients } = await getClientsFile();
  const assigned = clients.filter((c) => c.status === "assigned");
  const now = new Date();
  const { tickets } = clientsToBoard(assigned, now);
  const cards = buildBoardCards(assigned, tickets, await getSettings(), now);
  // ?open= acepta una card o una cuenta: de la cuenta abre su card abierta más reciente.
  const ofAccount = cards
    .filter((c) => c.accountId === open)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const isOpen = (id: string) => tickets.some((t) => t.cardId === id && !t.isDone);
  const openCard = cards.find((c) => c.id === open) ?? ofAccount.find((c) => isOpen(c.id)) ?? ofAccount[0];

  const heading = (
    <div>
      <h1 className="text-lg font-semibold">Tablero Seguimiento</h1>
      <p className="text-xs text-muted-foreground">
        Una card abierta por cliente. Lo nuevo se suma y se mueve sola al marcar puntos.
      </p>
    </div>
  );

  return (
    <div className="mx-auto flex max-w-[1760px] flex-col gap-3 px-6 py-3 lg:h-[calc(100dvh-3.6rem)]">
      {cards.length ? (
        <TrackingBoard
          heading={heading}
          cards={cards}
          tickets={tickets}
          initialOpenId={openCard?.id ?? null}
          nowIso={now.toISOString()}
        />
      ) : (
        <>
          {heading}
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Todavía no hay clientes asignados.{" "}
            <Link href="/clientes" className="font-medium text-primary underline-offset-4 hover:underline">
              Escanea y valida tus clientes
            </Link>{" "}
            para verlos acá.
          </div>
        </>
      )}
    </div>
  );
}
