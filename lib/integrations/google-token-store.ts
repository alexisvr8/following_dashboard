import { mkdir, readFile, writeFile, rm } from "fs/promises";
import path from "path";

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
  scope: string;
  obtainedAt: number;
}

const TOKENS_DIR = path.join(process.cwd(), ".data");
const TOKENS_FILE = path.join(TOKENS_DIR, "google-tokens.json");

export async function saveTokens(tokens: Omit<GoogleTokens, "obtainedAt">): Promise<void> {
  await mkdir(TOKENS_DIR, { recursive: true });
  const withTimestamp: GoogleTokens = { ...tokens, obtainedAt: Date.now() };
  await writeFile(TOKENS_FILE, JSON.stringify(withTimestamp, null, 2), "utf-8");
}

export async function getTokens(): Promise<GoogleTokens | null> {
  try {
    const raw = await readFile(TOKENS_FILE, "utf-8");
    return JSON.parse(raw) as GoogleTokens;
  } catch {
    return null;
  }
}

export async function clearTokens(): Promise<void> {
  await rm(TOKENS_FILE, { force: true });
}
