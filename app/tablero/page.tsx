import Link from "next/link";
import { TrackingBoard } from "@/components/tablero/TrackingBoard";
import { getClientsFile } from "@/lib/store/clients-store";
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
  const { accounts, meetings, tickets } = clientsToBoard(
    clients.filter((c) => c.status === "assigned"),
  );

  const heading = (
    <div>
      <h1 className="text-lg font-semibold">Tablero Seguimiento</h1>
      <p className="text-sm text-muted-foreground">
        Arrastra cada cuenta a su etapa actual. Haz click en una cuenta para ver los
        accionables de su última reunión.
      </p>
    </div>
  );

  return (
    <div className="space-y-6 px-6 py-8">
      {accounts.length ? (
        <TrackingBoard
          heading={heading}
          accounts={accounts}
          meetings={meetings}
          tickets={tickets}
          initialOpenId={open ?? null}
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
