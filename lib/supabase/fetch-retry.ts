// `fetch` para el cliente de Supabase que aguanta cortes breves (Cloudflare 52x, 502/503/504, timeouts,
// errores de red): reintenta con espera creciente y, si igual falla, devuelve un error JSON corto en vez
// de la página HTML de Cloudflare (que terminaba impresa entera en la consola).

const RETRY_STATUS = new Set([502, 503, 504, 520, 521, 522, 523, 524]);
const DELAYS_MS = [500, 1500, 3500];
const ATTEMPT_TIMEOUT_MS = 15_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function describe(input: RequestInfo | URL, init?: RequestInit): string {
  const url = new URL(input instanceof Request ? input.url : String(input));
  return `${init?.method ?? (input instanceof Request ? input.method : "GET")} ${url.pathname}`;
}

function unavailable(status: number, detail: string, attempts: number): Response {
  const message = `supabase_unavailable: ${detail} tras ${attempts} intento(s)`;
  return new Response(JSON.stringify({ message, code: String(status), details: null, hint: null }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const attempts = DELAYS_MS.length + 1;
  let last: { status: number; detail: string } = { status: 503, detail: "sin respuesta" };

  for (let attempt = 1; attempt <= attempts; attempt++) {
    // Cada intento tiene su propio límite; si quien llama aborta, se respeta.
    const timeout = AbortSignal.timeout(ATTEMPT_TIMEOUT_MS);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    try {
      const res = await fetch(input, { ...init, signal });
      if (!RETRY_STATUS.has(res.status)) return res;
      last = { status: res.status, detail: `HTTP ${res.status}` };
      await res.body?.cancel();
    } catch (error) {
      if (init?.signal?.aborted) throw error;
      const e = error as Error & { cause?: { code?: string; errors?: { code?: string }[] } };
      const code = e.cause?.code ?? e.cause?.errors?.[0]?.code;
      last = { status: 504, detail: e.name === "TimeoutError" ? `timeout ${ATTEMPT_TIMEOUT_MS / 1000}s` : (code ?? e.message) };
    }
    if (attempt < attempts) {
      console.warn(`[supabase] ${describe(input, init)}: ${last.detail}, reintento ${attempt}/${attempts - 1}`);
      await sleep(DELAYS_MS[attempt - 1]);
    }
  }
  console.error(`[supabase] ${describe(input, init)}: ${last.detail}, sin respuesta tras ${attempts} intentos`);
  return unavailable(last.status, last.detail, attempts);
}
