// Medidor aproximado del egress de Supabase (plan Free: 5 GB por ciclo): suma los bytes de cada respuesta que
// recibe `fetchWithRetry` (cuerpo ya descomprimido ⇒ cota superior) y los acumula por día en memoria. Cada
// `FLUSH_EVERY_MS` se suman a `app_state.supabase_egress` (`lib/store/egress-store.ts`, import dinámico para no
// cerrar el ciclo admin → fetch-retry → backend). Con dos equipos cada uno suma lo suyo.

export type EgressDay = { bytes: number; requests: number };
export type EgressByDay = Record<string, EgressDay>;

const FLUSH_EVERY_MS = 10 * 60_000;

const g = globalThis as unknown as { __egressPending?: EgressByDay; __egressFlushAt?: number; __egressFlushing?: boolean };
const pending = (): EgressByDay => (g.__egressPending ??= {});

const today = () => new Date().toLocaleDateString("en-CA");

/** Lo medido que todavía no se guardó (para sumarlo al mostrar). */
export function pendingEgress(): EgressByDay {
  return structuredClone(pending());
}

function add(bytes: number, requests: number): void {
  const day = (pending()[today()] ??= { bytes: 0, requests: 0 });
  day.bytes += bytes;
  day.requests += requests;
  const now = Date.now();
  g.__egressFlushAt ??= now;
  if (g.__egressFlushing || now - g.__egressFlushAt < FLUSH_EVERY_MS) return;
  g.__egressFlushing = true;
  g.__egressFlushAt = now;
  const batch = pending();
  g.__egressPending = {};
  import("@/lib/store/egress-store")
    .then((m) => m.addEgress(batch))
    .catch((error) => {
      // Si falla, se reintenta en la próxima tanda.
      for (const [d, v] of Object.entries(batch)) {
        const cur = (pending()[d] ??= { bytes: 0, requests: 0 });
        cur.bytes += v.bytes;
        cur.requests += v.requests;
      }
      console.warn("[egress] no se pudo guardar:", (error as Error).message);
    })
    .finally(() => {
      g.__egressFlushing = false;
    });
}

/** Envuelve la respuesta para contar sus bytes a medida que se leen. */
export function meterResponse(res: Response): Response {
  if (!res.body) {
    add(0, 1);
    return res;
  }
  let bytes = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
    flush() {
      add(bytes, 1);
    },
  });
  return new Response(res.body.pipeThrough(counter), { status: res.status, statusText: res.statusText, headers: res.headers });
}
