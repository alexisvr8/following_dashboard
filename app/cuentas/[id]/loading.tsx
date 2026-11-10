// Esqueleto del detalle mientras llega la cuenta: el directorio (layout) queda visible y el click responde al instante.
export default function CuentaLoading() {
  const block = "animate-pulse rounded-xl border border-border bg-card";
  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-col gap-4" aria-busy="true" aria-label="Cargando cuenta">
        <div className={`${block} h-36 shrink-0`} />
        <div className={`${block} h-80 flex-1`} />
      </div>
      <div className={`${block} min-h-64`} />
    </>
  );
}
