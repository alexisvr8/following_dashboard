import { cache } from "react";
import { getClient, getClientsFile } from "@/lib/store/clients-store";
import { getSettings } from "@/lib/store/settings-store";

// Deduplicadas por request: layout y página pueden pedir lo mismo sin repetir el viaje a Supabase.
export const getClientsFileCached = cache(getClientsFile);
export const getSettingsCached = cache(getSettings);
export const getClientCached = cache(getClient);
