// TODO Fase 2: generar accionables semanales reales a partir de integraciones/tickets.
// Disparado por un cron externo (GitHub Actions / cron de VPS), no por Vercel Cron.
export async function POST(req: Request) {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  return Response.json({
    ok: true,
    weekStartDate: new Date().toISOString().slice(0, 10),
    generated: 0,
    message: "stub - business logic not implemented yet",
  });
}
