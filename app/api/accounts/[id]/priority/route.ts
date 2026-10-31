import { classifyAccountPriority } from "@/lib/utils/priority-classifier";
import { mockAccounts } from "@/lib/mock/accounts";

// TODO Fase 2: leer time_score/difficulty_score reales desde Supabase.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const account = mockAccounts.find((a) => a.id === id);

  if (!account) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const quadrant = classifyAccountPriority({
    timeScore: account.timeScore,
    difficultyScore: account.difficultyScore,
  });

  return Response.json({
    accountId: id,
    timeScore: account.timeScore,
    difficultyScore: account.difficultyScore,
    quadrant,
  });
}
