import { getSettings, updateSettings, type WorkSettings } from "@/lib/store/settings-store";

export async function GET() {
  return Response.json(await getSettings());
}

export async function PUT(request: Request) {
  const body = (await request.json()) as Partial<WorkSettings>;
  return Response.json(await updateSettings(body));
}
