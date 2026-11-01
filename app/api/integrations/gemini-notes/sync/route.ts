import { listRecentMeetingDocs, getDocText } from "@/lib/integrations/drive";
import { addMeetingFromDoc, isDocIngested } from "@/lib/store/meetings-runtime";

// Trigger manual (sin cron todavía): busca Docs de "Notes by Gemini" en Drive y
// crea una Meeting por cada uno que matchee el dominio de email de alguna cuenta.
// La extracción de accionables desde el texto queda fuera de esta fase.
export async function POST() {
  const docs = await listRecentMeetingDocs();
  if (!docs) {
    return Response.json({ error: "google_not_connected" }, { status: 409 });
  }

  const created = [];
  for (const doc of docs) {
    if (isDocIngested(doc.fileId)) continue;

    const docText = await getDocText(doc.fileId);
    const meeting = addMeetingFromDoc({
      fileId: doc.fileId,
      docName: doc.name,
      docText,
      createdTime: doc.createdTime,
    });
    if (meeting) created.push(meeting);
  }

  return Response.json({ created: created.length, meetings: created });
}
