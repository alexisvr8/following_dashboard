import { ClientsReview } from "@/components/clientes/ClientsReview";
import { getClientsFile } from "@/lib/store/clients-store";
import { getUnassignedMails } from "@/lib/store/unassigned-mail-store";

export const dynamic = "force-dynamic";

export default async function ClientesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [file, unassigned, { tab }] = await Promise.all([getClientsFile(), getUnassignedMails(), searchParams]);

  return (
    <div className="space-y-6 px-6 py-8">
      <div>
        <h1 className="text-lg font-semibold">Clientes</h1>
        <p className="text-sm text-muted-foreground">
          Clientes detectados en tus minutas de Gemini Notes. Marca cuáles tienes asignados:
          solo los asignados aparecen en Cuentas.
        </p>
      </div>
      <ClientsReview file={file} unassigned={unassigned} initialTab={tab === "mails" ? "mails" : "pending"} />
    </div>
  );
}
