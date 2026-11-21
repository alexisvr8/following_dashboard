import { getState, setState } from "@/lib/store/backend";

// Bandeja "Mails sin cuenta" (capa C): mails externos dirigidos a mí (Para/Cc) de los últimos 15 días que la sync no
// pudo asignar a ninguna cuenta (partner o dev externo sin el cliente en el hilo, remitente nuevo…). Cada uno trae
// sugerencias por reglas; nunca se asigna solo. `app_state.unassigned_mails` (o `.data/unassigned-mails.json`).

export interface MailSuggestion {
  clientId: string;
  name: string;
  /** "Lo nombra: «Werthein»", "Dominio compartido vinculado"… */
  reasons: string[];
  /** 3 = lo nombra · 2 = dominio compartido / cita un mail del cliente · 1 = habla de un accionable. */
  strength: number;
}

export interface UnassignedMail {
  threadId: string;
  /** Último mensaje externo del hilo (el que se muestra). */
  messageId: string;
  from: string;
  fromName: string | null;
  subject: string;
  date: string;
  /** Texto propio del mail (sin citas), recortado. */
  excerpt: string;
  messages: number;
  /** Respondí yo en el hilo. */
  iWrote: boolean;
  suggestions: MailSuggestion[];
}

export interface UnassignedState {
  items: UnassignedMail[];
  /** Hilos descartados ("No es de ninguna cuenta"): no vuelven. */
  dismissedThreads: string[];
  ignoredSenders: string[];
  ignoredDomains: string[];
  scannedAt: string | null;
}

const EMPTY: UnassignedState = { items: [], dismissedThreads: [], ignoredSenders: [], ignoredDomains: [], scannedAt: null };

export async function getUnassignedMails(): Promise<UnassignedState> {
  return { ...EMPTY, ...((await getState<Partial<UnassignedState>>("unassigned_mails")) ?? {}) };
}

/** Guarda el resultado de un escaneo (conserva descartes e ignorados). */
export async function saveUnassignedScan(items: UnassignedMail[]): Promise<void> {
  const cur = await getUnassignedMails();
  await setState("unassigned_mails", { ...cur, items, scannedAt: new Date().toISOString() });
}

/** Saca un hilo de la bandeja (asignado a una cuenta). */
export async function removeUnassignedThread(threadId: string): Promise<void> {
  const cur = await getUnassignedMails();
  await setState("unassigned_mails", { ...cur, items: cur.items.filter((i) => i.threadId !== threadId) });
}

/** "No es de ninguna cuenta": descarta el hilo y, si se pide, ignora al remitente o su dominio de ahora en más. */
export async function dismissUnassignedThread(threadId: string, ignore: "sender" | "domain" | null): Promise<void> {
  const cur = await getUnassignedMails();
  const item = cur.items.find((i) => i.threadId === threadId);
  const domain = item?.from.split("@")[1];
  const next: UnassignedState = {
    ...cur,
    items: cur.items.filter((i) =>
      i.threadId === threadId
        ? false
        : ignore === "sender" && item
          ? i.from !== item.from
          : ignore === "domain" && domain
            ? !i.from.endsWith(`@${domain}`)
            : true,
    ),
    dismissedThreads: [...new Set([...cur.dismissedThreads, threadId])].slice(-500),
    ignoredSenders: ignore === "sender" && item ? [...new Set([...cur.ignoredSenders, item.from])] : cur.ignoredSenders,
    ignoredDomains: ignore === "domain" && domain ? [...new Set([...cur.ignoredDomains, domain])] : cur.ignoredDomains,
  };
  await setState("unassigned_mails", next);
}
