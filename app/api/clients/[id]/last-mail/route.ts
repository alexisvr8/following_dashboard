import { getClientsFile } from "@/lib/store/clients-store";
import { findLatestThreadIdForClient } from "@/lib/integrations/gmail";

// Redirige al último hilo de Gmail con el cliente. Fallback: búsqueda en Gmail.
const FREEMAIL = /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|icloud|proton|protonmail)\./;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { clients } = await getClientsFile();
  const client = clients.find((c) => c.id === decodeURIComponent(id));
  if (!client) return Response.json({ error: "not_found" }, { status: 404 });

  const domain = FREEMAIL.test(client.domain) ? null : client.domain;
  const targets = domain ? `@${domain}` : client.contactEmails.join(" OR ");
  const search = `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(
    `from:(${targets}) OR to:(${targets})`,
  )}`;

  try {
    const found = await findLatestThreadIdForClient(domain, client.contactEmails);
    if (found) {
      const auth = found.account ? `?authuser=${encodeURIComponent(found.account)}` : "";
      return Response.redirect(`https://mail.google.com/mail/${auth}#all/${found.threadId}`, 302);
    }
  } catch {
    // Google desconectado / rate limit: caemos a la búsqueda.
  }
  return Response.redirect(search, 302);
}
