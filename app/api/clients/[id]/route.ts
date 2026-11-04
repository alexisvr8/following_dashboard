import {
  changeActionable,
  clearBoardOverride,
  getClientsFile,
  setBoardOverride,
  setTicketDone,
  updateClient,
  updateClientProfile,
  type ActionableChange,
  type ClientProfile,
  type ClientStatus,
} from "@/lib/store/clients-store";
import { getSettings } from "@/lib/store/settings-store";
import { TRACKING_COLUMNS } from "@/lib/tracking";
import { clientsToBoard } from "@/lib/utils/clients-to-board";
import type { TrackingStatus } from "@/types/account";

const STATUSES: ClientStatus[] = ["pending", "assigned", "unassigned", "ignored"];

/** Tildar o agregar un punto devuelve su card al estado automático, aunque se hubiera ubicado a mano. */
async function releaseCard(clientId: string, ticketId: string) {
  const { clients } = await getClientsFile();
  const client = clients.find((c) => c.id === clientId);
  if (!client) return;
  const cardId = clientsToBoard([client]).tickets.find((t) => t.id === ticketId)?.cardId;
  if (cardId) await clearBoardOverride(clientId, cardId);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as {
    status?: ClientStatus;
    name?: string;
    trackingStatus?: TrackingStatus;
    ticketId?: string;
    isDone?: boolean;
    profile?: Partial<ClientProfile>;
    boardCard?: { id?: string; status?: TrackingStatus };
    actionable?: ActionableChange;
  };

  if (body.boardCard) {
    const { id: cardId, status } = body.boardCard;
    if (typeof cardId !== "string" || !TRACKING_COLUMNS.some((c) => c.status === status)) {
      return Response.json({ error: "invalid_card" }, { status: 400 });
    }
    const client = await setBoardOverride(decodeURIComponent(id), cardId, status!);
    if (!client) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ id: client.id, cardId, status });
  }

  if (body.actionable) {
    const change = body.actionable;
    let parsed: ActionableChange;
    if (change.op === "remove" && typeof change.id === "string") {
      parsed = change;
    } else if ((change.op === "add" || change.op === "edit") && typeof change.title === "string" && change.title.trim()) {
      const title = change.title.trim().slice(0, 500);
      if (change.op === "edit") {
        if (typeof change.id !== "string") return Response.json({ error: "invalid_actionable" }, { status: 400 });
        parsed = { op: "edit", id: change.id, title };
      } else {
        // Sin "[Dueño]" el punto es mío: con el prefijo se ubica "De nuestro lado" en los mails.
        const alias = (await getSettings()).ownerAliases[0];
        parsed = {
          op: "add",
          title: title.startsWith("[") || !alias ? title : `[${alias}] ${title}`,
        };
      }
    } else {
      return Response.json({ error: "invalid_actionable" }, { status: 400 });
    }
    const result = await changeActionable(decodeURIComponent(id), parsed);
    if (!result) return Response.json({ error: "not_found" }, { status: 404 });
    if (parsed.op === "add") await releaseCard(result.client.id, result.ticketId);
    return Response.json({ id: result.client.id, ticketId: result.ticketId });
  }

  if (body.profile && typeof body.profile === "object") {
    const p = body.profile;
    const patch: Partial<ClientProfile> = {};
    for (const k of ["emailName", "erp", "ownerEmail", "notes"] as const) {
      if (typeof p[k] === "string") patch[k] = p[k].slice(0, 2000);
    }
    if (p.referentOverrides && typeof p.referentOverrides === "object") {
      patch.referentOverrides = Object.fromEntries(
        Object.entries(p.referentOverrides)
          .filter(([, v]) => typeof v === "boolean")
          .map(([k, v]) => [k.toLowerCase(), v]),
      );
    }
    if (p.contactNames && typeof p.contactNames === "object") {
      patch.contactNames = Object.fromEntries(
        Object.entries(p.contactNames)
          .filter(([, v]) => typeof v === "string")
          .map(([k, v]) => [k.toLowerCase(), v.slice(0, 120)]),
      );
    }
    let client = await updateClientProfile(decodeURIComponent(id), patch);
    if (client && typeof body.name === "string" && body.name.trim()) {
      client = await updateClient(client.id, { name: body.name.trim() });
    }
    if (!client) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ id: client.id, name: client.name, profile: client.profile });
  }

  if (typeof body.ticketId === "string" && typeof body.isDone === "boolean") {
    const client = await setTicketDone(decodeURIComponent(id), body.ticketId, body.isDone);
    if (!client) return Response.json({ error: "not_found" }, { status: 404 });
    await releaseCard(client.id, body.ticketId);
    return Response.json({
      id: client.id,
      doneTicketIds: client.doneTicketIds,
      doneAt: client.doneTicketAt?.[body.ticketId] ?? null,
    });
  }

  const patch: Parameters<typeof updateClient>[1] = {};
  if (body.status && STATUSES.includes(body.status)) patch.status = body.status;
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (body.trackingStatus && TRACKING_COLUMNS.some((c) => c.status === body.trackingStatus)) {
    patch.trackingStatus = body.trackingStatus;
  }

  const client = await updateClient(decodeURIComponent(id), patch);
  if (!client) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ id: client.id, status: client.status, name: client.name });
}
