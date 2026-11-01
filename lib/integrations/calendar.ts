import { google } from "googleapis";
import { getAuthorizedClient } from "./google-client";

export interface FreeBusySlot {
  start: string;
  end: string;
}

export async function getFreeBusy(
  durationMinutes: number,
  lookAheadDays = 5,
): Promise<FreeBusySlot[] | null> {
  const auth = await getAuthorizedClient();
  if (!auth) return null;

  const calendar = google.calendar({ version: "v3", auth });
  const timeMin = new Date();
  const timeMax = new Date(timeMin.getTime() + lookAheadDays * 86_400_000);

  const freeBusy = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: "primary" }],
    },
  });

  const busy = freeBusy.data.calendars?.primary?.busy ?? [];

  const slots: FreeBusySlot[] = [];
  let cursor = timeMin.getTime();
  const durationMs = durationMinutes * 60_000;

  for (const block of busy) {
    const blockStart = new Date(block.start!).getTime();
    while (cursor + durationMs <= blockStart && slots.length < 3) {
      slots.push({
        start: new Date(cursor).toISOString(),
        end: new Date(cursor + durationMs).toISOString(),
      });
      cursor += durationMs;
    }
    cursor = Math.max(cursor, new Date(block.end!).getTime());
  }

  while (slots.length < 3 && cursor + durationMs <= timeMax.getTime()) {
    slots.push({
      start: new Date(cursor).toISOString(),
      end: new Date(cursor + durationMs).toISOString(),
    });
    cursor += durationMs;
  }

  return slots;
}

export interface CalendarEventLite {
  id: string;
  title: string;
  start: string;
  end: string;
  minutes: number;
  attendees: string[];
}

/** Eventos con hora (no día completo) en [from, to) del calendario principal. */
export async function listEventsBetween(from: Date, to: Date): Promise<CalendarEventLite[] | null> {
  const auth = await getAuthorizedClient();
  if (!auth) return null;
  const calendar = google.calendar({ version: "v3", auth });
  const out: CalendarEventLite[] = [];
  let pageToken: string | undefined;
  do {
    const res = await calendar.events.list({
      calendarId: "primary",
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: true,
      maxResults: 250,
      pageToken,
    });
    for (const e of res.data.items ?? []) {
      if (!e.start?.dateTime || !e.end?.dateTime || e.status === "cancelled") continue;
      // "Disponible" y ubicación de trabajo no ocupan tiempo.
      if (e.transparency === "transparent" || e.eventType === "workingLocation") continue;
      const self = e.attendees?.find((a) => a.self);
      if (self?.responseStatus === "declined") continue;
      out.push({
        id: e.id ?? `${e.start.dateTime}-${e.summary}`,
        title: e.summary ?? "(sin título)",
        start: e.start.dateTime,
        end: e.end.dateTime,
        minutes: Math.round((Date.parse(e.end.dateTime) - Date.parse(e.start.dateTime)) / 60_000),
        attendees: (e.attendees ?? []).filter((a) => a.email && !a.resource).map((a) => a.email!.toLowerCase()),
      });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}
