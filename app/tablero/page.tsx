import { TrackingBoard } from "@/components/tablero/TrackingBoard";
import { mockAccounts } from "@/lib/mock/accounts";

export default function TableroPage() {
  return (
    <div className="space-y-6 px-6 py-8">
      <div>
        <h1 className="text-lg font-semibold">Tablero Seguimiento</h1>
        <p className="text-sm text-muted-foreground">
          Arrastra cada cuenta a su estado de seguimiento actual.
        </p>
      </div>
      <TrackingBoard accounts={mockAccounts} />
    </div>
  );
}
