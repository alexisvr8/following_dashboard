import { redirect } from "next/navigation";
import { clientsToBoard } from "@/lib/utils/clients-to-board";
import { byMovement } from "@/lib/utils/movement";
import { getClientsFileCached } from "@/lib/server/cached-data";

export const dynamic = "force-dynamic";

// Entrada de /cuentas: la cuenta vive en /cuentas/[id]. `?id=` (links viejos, mails, borradores automáticos)
// redirige a esa ruta; sin id se abre la cuenta con movimiento más reciente de la pestaña pedida.
export default async function CuentasIndex({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; tab?: string; borrador?: string }>;
}) {
  const { id, tab, borrador } = await searchParams;
  const suffix = borrador ? `?borrador=${encodeURIComponent(borrador)}#borradores` : "";
  if (id) redirect(`/cuentas/${encodeURIComponent(id)}${suffix}`);

  const file = await getClientsFileCached();
  const validated = file.clients.filter((c) => c.status === "assigned" || c.status === "unassigned");
  const { accounts } = clientsToBoard(validated, new Date(), file.ownerEmail ?? null);
  const assigned = tab !== "unassigned";
  const first = accounts.filter((a) => a.isAssigned === assigned).sort(byMovement)[0] ?? accounts.sort(byMovement)[0];
  // Sin cuentas el layout ya muestra el estado vacío.
  if (!first) return null;
  redirect(`/cuentas/${encodeURIComponent(first.id)}${suffix}`);
}
