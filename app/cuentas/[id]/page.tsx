import { redirect } from "next/navigation";

// Ruta histórica (links viejos, mails y borradores automáticos): la cuenta vive en /cuentas?id=.
export default async function CuentaRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ borrador?: string }>;
}) {
  const { id } = await params;
  const { borrador } = await searchParams;
  const qs = new URLSearchParams({ id: decodeURIComponent(id) });
  if (borrador) qs.set("borrador", borrador);
  redirect(`/cuentas?${qs}${borrador ? "#borradores" : ""}`);
}
