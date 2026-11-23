import { getState, setState } from "@/lib/store/backend";

/**
 * Orden manual del tablero de /accionables (`app_state.board_order` o `.data/board-order.json`): `columna|ticketId`
 * (`orderKey`) → posición dentro de su grupo de esa columna. Solo visual: Capacidad no lo usa.
 */
export type BoardOrder = Record<string, number>;

export async function getBoardOrder(): Promise<BoardOrder> {
  return (await getState<BoardOrder>("board_order")) ?? {};
}

/** Combina `patch` con lo guardado; `keep` (claves vigentes) poda lo cerrado y lo que cambió de columna. */
export async function updateBoardOrder(patch: BoardOrder, keep?: string[]): Promise<BoardOrder> {
  const current = await getBoardOrder();
  const merged: BoardOrder = { ...current, ...patch };
  const alive = keep ? new Set(keep) : null;
  const next = Object.fromEntries(
    Object.entries(merged).filter(([id, n]) => Number.isFinite(n) && (!alive || alive.has(id))),
  );
  await setState("board_order", next);
  return next;
}
