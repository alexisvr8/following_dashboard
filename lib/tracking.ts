import type { TrackingStatus } from "@/types/account";

export const TRACKING_COLUMNS: { status: TrackingStatus; label: string }[] = [
  { status: "no_contact", label: "Sin contacto" },
  { status: "in_progress", label: "En seguimiento" },
  { status: "waiting_client", label: "Esperando cliente" },
  { status: "at_risk", label: "En riesgo" },
  { status: "closed_ok", label: "Cerrado / Al día" },
];
