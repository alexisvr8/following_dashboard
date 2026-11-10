import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build autocontenido solo para Docker (`NEXT_OUTPUT=standalone`); en el Mac se usa `next start`.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // Abajo a la izquierda tapaba el botón Enviar del redactor de la cuenta.
  devIndicators: { position: "bottom-right" },
  // Router Cache del navegador: una página/cuenta visitada hace < 2 min se muestra desde memoria al volver.
  // Siempre fresco igual: cada mutación y cada sync nueva (SyncStatus) hacen `router.refresh()`, que lo invalida.
  experimental: { staleTimes: { dynamic: 120 } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
