import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
