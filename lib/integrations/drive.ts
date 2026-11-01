import { google } from "googleapis";
import { getAuthorizedClient } from "./google-client";

export interface MeetingDoc {
  fileId: string;
  name: string;
  createdTime: string;
}

// Busca Docs recientes creados por Google Meet con notas de Gemini
// (el nombre por defecto de Google Meet es "Notes by Gemini - <reunión> - <fecha>").
export async function listRecentMeetingDocs(): Promise<MeetingDoc[] | null> {
  const auth = await getAuthorizedClient();
  if (!auth) return null;

  const drive = google.drive({ version: "v3", auth });
  const result = await drive.files.list({
    q: "name contains 'Notes by Gemini' and mimeType = 'application/vnd.google-apps.document'",
    orderBy: "createdTime desc",
    pageSize: 10,
    fields: "files(id, name, createdTime)",
  });

  return (result.data.files ?? []).map((file) => ({
    fileId: file.id!,
    name: file.name!,
    createdTime: file.createdTime!,
  }));
}

export async function getDocText(fileId: string): Promise<string> {
  const auth = await getAuthorizedClient();
  if (!auth) throw new Error("google_not_connected");

  const drive = google.drive({ version: "v3", auth });
  const result = await drive.files.export(
    { fileId, mimeType: "text/plain" },
    { responseType: "text" },
  );

  return result.data as unknown as string;
}
