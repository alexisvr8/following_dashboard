// Combina un ClientRecord local (`.data/clients.json` de otra PC) con el que ya está en Supabase,
// sin perder trabajo manual de ninguno de los dos lados. Lo usa migrate-to-supabase.mjs --merge.

const newer = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
const older = (a, b) => (!a ? b : !b ? a : a < b ? a : b);
const union = (a = [], b = []) => [...new Set([...a, ...b])];
const unionBy = (a = [], b = [], key, pick = (x) => x) => {
  const map = new Map(a.map((x) => [key(x), x]));
  for (const x of b) map.set(key(x), map.has(key(x)) ? pick(map.get(key(x)), x) : x);
  return [...map.values()];
};

/** `db` = fila actual en Supabase, `local` = la del archivo. Devuelve el registro combinado y los conflictos. */
export function mergeClient(db, local) {
  const out = { ...db };

  // Estado/nombre: lo validado gana a "pending". Si los dos lados difieren, se conserva Supabase
  // (no hay fecha para saber cuál es más nuevo) y `conflicts` lo informa para revisarlo a mano.
  const conflicts = [];
  if (db.status === "pending" && local.status !== "pending") out.status = local.status;
  else if (local.status !== "pending" && local.status !== db.status) conflicts.push(`estado: base=${db.status}, archivo=${local.status}`);
  if (local.name && local.name !== db.name) conflicts.push(`nombre: base="${db.name}", archivo="${local.name}"`);
  out.contactEmails = union(db.contactEmails, local.contactEmails);

  // Reuniones: unión por id; ante duplicado se queda la que ya tiene hitos reprocesados.
  out.meetings = unionBy(db.meetings, local.meetings, (m) => m.id, (a, b) => (a.milestones !== undefined ? a : b))
    .sort((a, b) => b.date.localeCompare(a.date));

  // Accionables: tildados de cualquiera de los dos lados (fecha = el primer cierre).
  out.doneTicketIds = union(db.doneTicketIds, local.doneTicketIds);
  out.doneTicketAt = { ...local.doneTicketAt };
  for (const [id, at] of Object.entries(db.doneTicketAt ?? {})) out.doneTicketAt[id] = older(out.doneTicketAt[id], at);
  out.ticketsUpdatedAt = newer(db.ticketsUpdatedAt, local.ticketsUpdatedAt);
  out.profileUpdatedAt = newer(db.profileUpdatedAt, local.profileUpdatedAt);
  out.actionableEdits = { ...db.actionableEdits, ...local.actionableEdits };
  out.customActionables = unionBy(db.customActionables, local.customActionables, (c) => c.id);
  out.removedTicketIds = union(db.removedTicketIds, local.removedTicketIds);
  out.mailActionables = { ...local.mailActionables, ...db.mailActionables };

  // Cards movidas a mano: por card, la más reciente.
  out.boardOverrides = { ...db.boardOverrides };
  for (const [card, o] of Object.entries(local.boardOverrides ?? {})) {
    if (!out.boardOverrides[card] || o.at > out.boardOverrides[card].at) out.boardOverrides[card] = o;
  }

  if (db.profile || local.profile) {
    const profile = { ...db.profile, ...local.profile };
    const referents = { ...db.profile?.referentOverrides, ...local.profile?.referentOverrides };
    const names = { ...db.profile?.contactNames, ...local.profile?.contactNames };
    if (Object.keys(referents).length) profile.referentOverrides = referents;
    if (Object.keys(names).length) profile.contactNames = names;
    out.profile = profile;
  }

  // Actividad de Gmail y borradores: la versión más reciente.
  if (local.activity && (!db.activity || local.activity.syncedAt > db.activity.syncedAt)) out.activity = local.activity;
  out.followups = { ...db.followups };
  for (const [key, f] of Object.entries(local.followups ?? {})) {
    if (!out.followups[key] || f.updatedAt > out.followups[key].updatedAt) out.followups[key] = f;
  }

  // No agregar campos vacíos que ninguno de los dos tenía.
  for (const k of Object.keys(out)) if (!(k in db) && !(k in local)) delete out[k];
  return { merged: out, conflicts };
}

/** Resumen de lo que aporta el archivo local a un cliente (para mostrar antes de escribir). */
export function diffSummary(db, merged) {
  const parts = [];
  const n = (x) => (Array.isArray(x) ? x.length : Object.keys(x ?? {}).length);
  const add = (label, before, after) => after > before && parts.push(`+${after - before} ${label}`);
  add("reuniones", n(db.meetings), n(merged.meetings));
  add("tildados", n(db.doneTicketIds), n(merged.doneTicketIds));
  add("accionables propios", n(db.customActionables), n(merged.customActionables));
  add("ediciones", n(db.actionableEdits), n(merged.actionableEdits));
  add("quitados", n(db.removedTicketIds), n(merged.removedTicketIds));
  add("cards movidas", n(db.boardOverrides), n(merged.boardOverrides));
  add("borradores", n(db.followups), n(merged.followups));
  if (db.status !== merged.status) parts.push(`estado ${db.status}→${merged.status}`);
  if (db.name !== merged.name) parts.push(`nombre "${db.name}"→"${merged.name}"`);
  if (!sameJson(db.profile ?? {}, merged.profile ?? {})) parts.push("perfil");
  if (merged.activity !== db.activity) parts.push("actividad más reciente");
  return parts;
}

/** Igualdad sin importar el orden de las claves (Postgres jsonb las reordena al guardar). */
export function sameJson(a, b) {
  const canon = (v) =>
    Array.isArray(v) ? v.map(canon)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
    : v;
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}
