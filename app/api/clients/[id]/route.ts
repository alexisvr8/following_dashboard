import {
  setTicketDone,
  updateClient,
  updateClientProfile,
  type ClientProfile,
  type ClientStatus,
} from "@/lib/store/clients-store";
import { TRACKING_COLUMNS } from "@/lib/tracking";
import type { TrackingStatus } from "@/types/account";

const STATUSES: ClientStatus[] = ["pending", "assigned", "unassigned", "ignored"];

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
  };

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
