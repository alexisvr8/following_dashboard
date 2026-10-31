import { Separator } from "@/components/ui/separator";
import { TicketItem } from "@/components/dashboard/TicketItem";
import type { Ticket } from "@/types/ticket";

export function WeeklyTicketList({ tickets }: { tickets: Ticket[] }) {
  const weeks = Array.from(new Set(tickets.map((t) => t.weekStartDate))).sort().reverse();

  return (
    <div className="space-y-6">
      {weeks.map((week) => (
        <div key={week} className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">
            Semana del {week}
          </h3>
          <div className="space-y-2">
            {tickets
              .filter((t) => t.weekStartDate === week)
              .map((ticket) => (
                <TicketItem key={ticket.id} ticket={ticket} />
              ))}
          </div>
          <Separator className="mt-4" />
        </div>
      ))}
    </div>
  );
}
