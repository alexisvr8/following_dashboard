import type { ClientRecord } from "@/lib/store/clients-store";

// Participantes de una cuenta a partir de los asistentes de sus reuniones (Calendar).
// Rol:
// - owner: owner de Xtract de la cuenta (perfil o cuenta que corrió el escaneo).
// - team: mismo dominio que el owner (equipo Xtract), salvo freemail.
// - referent: dominio del mail coincide con el nombre de la empresa (nombre / nombre en
//   correos / dominio del cliente). Override manual en `profile.referentOverrides`.
// - external: resto (consultores, partners, etc.).

export type ParticipantRole = "owner" | "team" | "referent" | "external";

export interface Participant {
  email: string;
  name: string | null;
  role: ParticipantRole;
  /** Nombre puesto a mano en el perfil (para mostrar y saludar); `name` queda como lo detectó Calendar. */
  customName: string | null;
  /** true si el rol de referente viene de un override manual. */
  manual: boolean;
  meetingCount: number;
  lastSeenAt: string | null;
}

const FREEMAIL = new Set([
  "gmail", "googlemail", "hotmail", "outlook", "live", "msn", "yahoo", "icloud", "proton", "protonmail",
]);
const GENERIC = new Set(["com", "co", "net", "org", "gob", "gov", "edu", "io", "ai", "app", "ws", "la"]);
const LEGAL_SUFFIXES = /\b(s\.?a\.?|s\.?r\.?l\.?|s\.?a\.?s\.?|ltda|inc|llc|group|grupo)\b/g;

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(LEGAL_SUFFIXES, "")
    .replace(/[^a-z0-9]/g, "");

const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";
const isFreemail = (domain: string) => FREEMAIL.has(domain.split(".")[0]);

/** Labels significativos del dominio: `ar.mcd.com` → ["mcd"], `sigma-agro.com` → ["sigmaagro"]. */
function domainLabels(domain: string): string[] {
  return domain
    .split(".")
    .filter((l) => l.length >= 3 && !GENERIC.has(l))
    .map(norm)
    .filter(Boolean);
}

/** ¿Es la cuenta dueña o alguien de su mismo dominio? (un dominio freemail no define un equipo). */
export function isOwnTeamEmail(email: string, ownerEmail: string | null | undefined): boolean {
  const owner = ownerEmail?.toLowerCase();
  if (!owner) return false;
  const e = email.toLowerCase();
  const domain = domainOf(owner);
  return e === owner || (!isFreemail(domain) && domainOf(e) === domain);
}

export function domainMatchesCompany(email: string, names: string[]): boolean {
  const domain = domainOf(email);
  if (!domain || isFreemail(domain)) return false;
  const targets = names.map(norm).filter((n) => n.length >= 3);
  return domainLabels(domain).some((label) =>
    targets.some((t) => t === label || t.includes(label) || label.includes(t)),
  );
}

export function computeParticipants(
  client: ClientRecord,
  fallbackOwnerEmail: string | null | undefined,
): Participant[] {
  const ownerEmail = (client.profile?.ownerEmail ?? fallbackOwnerEmail ?? "").toLowerCase() || null;
  const ownerDomain = ownerEmail ? domainOf(ownerEmail) : "";
  const companyNames = [client.name, client.profile?.emailName ?? "", isFreemail(client.domain) ? "" : client.domain];
  const overrides = client.profile?.referentOverrides ?? {};

  const byEmail = new Map<string, Participant>();
  const touch = (email: string, name: string | null, date: string | null) => {
    const p = byEmail.get(email) ?? {
      email, name, customName: client.profile?.contactNames?.[email] ?? null,
      role: "external" as ParticipantRole, manual: false, meetingCount: 0, lastSeenAt: null,
    };
    if (!p.name && name) p.name = name;
    if (date) {
      p.meetingCount++;
      if (!p.lastSeenAt || date > p.lastSeenAt) p.lastSeenAt = date;
    }
    byEmail.set(email, p);
  };

  for (const m of client.meetings) {
    for (const a of m.attendees ?? []) touch(a.email, a.name, m.date);
  }
  // Contactos detectados antes de guardar asistentes por reunión (re-escaneo hace backfill).
  for (const email of client.contactEmails) touch(email.toLowerCase(), null, null);
  if (ownerEmail) touch(ownerEmail, null, null);

  for (const p of byEmail.values()) {
    const domain = domainOf(p.email);
    if (p.email === ownerEmail) p.role = "owner";
    else if (ownerDomain && !isFreemail(ownerDomain) && domain === ownerDomain) p.role = "team";
    else if (p.email in overrides) {
      p.role = overrides[p.email] ? "referent" : "external";
      p.manual = true;
    } else if (domainMatchesCompany(p.email, companyNames)) p.role = "referent";
  }

  const ORDER: Record<ParticipantRole, number> = { owner: 0, referent: 1, team: 2, external: 3 };
  return [...byEmail.values()].sort(
    (a, b) => ORDER[a.role] - ORDER[b.role] || b.meetingCount - a.meetingCount || a.email.localeCompare(b.email),
  );
}
