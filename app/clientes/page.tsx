import { ClientsReview } from "@/components/clientes/ClientsReview";
import { getClientsFile } from "@/lib/store/clients-store";

export const dynamic = "force-dynamic";

export default async function ClientesPage() {
  const file = await getClientsFile();

  return (
    <div className="space-y-6 px-6 py-8">
      <div>
        <h1 className="text-lg font-semibold">Clientes</h1>
        <p className="text-sm text-muted-foreground">
          Clientes detectados en tus minutas de Gemini Notes. Marca cuáles tienes asignados:
          solo los asignados aparecen en el Tablero Seguimiento.
        </p>
      </div>
      <ClientsReview file={file} />
    </div>
  );
}
