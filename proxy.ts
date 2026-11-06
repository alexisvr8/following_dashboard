import { NextResponse, type NextRequest } from "next/server";

// Basic Auth para exponer la app en un servidor (es de un solo usuario y muestra mails/tokens).
// Activa solo si están APP_USER y APP_PASSWORD; en local sin esas variables no pide nada.
// Quedan fuera los callbacks de OAuth (los llama Google/Notion) y los POST a /api/cron/* (validan
// x-cron-secret); el GET de estado de /api/cron/sync sí pide credenciales (el navegador ya las manda).
export function proxy(request: NextRequest) {
  const user = process.env.APP_USER;
  const password = process.env.APP_PASSWORD;
  if (!user || !password) return NextResponse.next();
  if (request.method === "POST" && request.nextUrl.pathname.startsWith("/api/cron/")) return NextResponse.next();

  const header = request.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = atob(encoded);
    const sep = decoded.indexOf(":");
    if (sep >= 0 && safeEqual(decoded.slice(0, sep), user) && safeEqual(decoded.slice(sep + 1), password)) {
      return NextResponse.next();
    }
  }
  return new NextResponse("Autenticación requerida", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Xtract", charset="UTF-8"' },
  });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth/google/callback|api/auth/notion/callback).*)"],
};
