import { getState, setState } from "@/lib/store/backend";

// Mismo patrón que google-token-store: `app_state.notion_tokens` (o `.data/notion-tokens.json`).
export interface NotionTokens {
  accessToken: string;
  refreshToken: string | null;
  workspaceName: string | null;
  botId: string;
  obtainedAt: number;
}

export async function saveNotionTokens(tokens: Omit<NotionTokens, "obtainedAt">): Promise<void> {
  const withTimestamp: NotionTokens = { ...tokens, obtainedAt: Date.now() };
  await setState("notion_tokens", withTimestamp);
}

export async function getNotionTokens(): Promise<NotionTokens | null> {
  try {
    return await getState<NotionTokens>("notion_tokens");
  } catch {
    return null;
  }
}
