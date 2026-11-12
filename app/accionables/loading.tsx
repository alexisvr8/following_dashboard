// Esqueleto mientras llegan clientes y Calendar.
export default function AccionablesLoading() {
  const block = "animate-pulse rounded-xl border border-border bg-card";
  return (
    <div className="space-y-5 px-4 py-6 sm:px-6" aria-busy="true" aria-label="Cargando accionables">
      <div className={`${block} h-12 w-80 max-w-full`} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={`${block} h-16`} />
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={`${block} h-96`} />
        ))}
      </div>
    </div>
  );
}
