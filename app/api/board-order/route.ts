import { getBoardOrder, updateBoardOrder, type BoardOrder } from "@/lib/store/board-order-store";

export async function GET() {
  return Response.json(await getBoardOrder());
}

/** `{order: {ticketId: posición}, keep?: ticketIds vigentes}` → orden manual del tablero de /accionables. */
export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as { order?: BoardOrder; keep?: string[] } | null;
  if (!body?.order || typeof body.order !== "object") return Response.json({ error: "order_required" }, { status: 400 });
  return Response.json(await updateBoardOrder(body.order, Array.isArray(body.keep) ? body.keep : undefined));
}
