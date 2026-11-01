import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

// Mismo patrón que google-token-store: archivo local gitignored, sin Supabase todavía.
export interface NotionTokens {
  accessToken: string;
  refreshToken: string | null;
  workspaceName: string | null;
  botId: string;
  obtainedAt: number;
}

const TOKENS_DIR = path.join(process.cwd(), ".data");
const TOKENS_FILE = path.join(TOKENS_DIR, "notion-tokens.json");

export async function saveNotionTokens(tokens: Omit<NotionTokens, "obtainedAt">): Promise<void> {
  await mkdir(TOKENS_DIR, { recursive: true });
  const withTimestamp: NotionTokens = { ...tokens, obtainedAt: Date.now() };
  await writeFile(TOKENS_FILE, JSON.stringify(withTimestamp, null, 2), "utf-8");
}

export async function getNotionTokens(): Promise<NotionTokens | null> {
  try {
    return JSON.parse(await readFile(TOKENS_FILE, "utf-8")) as NotionTokens;
  } catch {
    return null;
  }
}
