// Caché en memoria del proceso de lo que la sync baja de Gmail. Un mail enviado no cambia (su id es fijo) y un hilo
// solo cambia si cambia su `historyId` (que ya trae `threads.list`): volver a bajarlos en cada corrida solo suma
// pedidos y termina en "User-rate limit exceeded". Con la caché, cada corrida hace las búsquedas y baja solo lo nuevo.
// Se pierde al reiniciar (la primera corrida baja todo una vez).
const g = globalThis as unknown as { __gmailCache?: Map<string, { at: number; value: unknown }> };

const MAX_ENTRIES = 2000;
/** Para hilos sin `historyId` conocido (fijados / asignados a mano que no salieron en la búsqueda). */
export const THREAD_TTL_MS = 30 * 60_000;

/** Devuelve lo guardado bajo `key` (si no venció) o lo baja con `fetch` y lo guarda. Los errores no se guardan. */
export async function gmailCached<T>(key: string, fetch: () => Promise<T>, ttlMs = Infinity): Promise<T> {
  const cache = (g.__gmailCache ??= new Map());
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) {
    cache.delete(key); // LRU: queda como el más reciente
    cache.set(key, hit);
    return hit.value as T;
  }
  const value = await fetch();
  cache.set(key, { at: Date.now(), value });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return value;
}
