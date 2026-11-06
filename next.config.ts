import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build autocontenido solo para Docker (`NEXT_OUTPUT=standalone`); en el Mac se usa `next start`.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // Abajo a la izquierda tapaba el botón Enviar del redactor de la cuenta.
  devIndicators: { position: "bottom-right" },
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
