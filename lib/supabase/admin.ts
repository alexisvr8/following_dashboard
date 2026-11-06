import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Cliente con service_role para el servidor (rutas, páginas y el scheduler, que corre fuera de una
// request y no tiene cookies). Nunca importar desde componentes cliente.
let admin: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (admin) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("supabase_not_configured: faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}
