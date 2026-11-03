import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  cacheComponents: false,
  images: {
    // As imagens de produto são servidas pelo Supabase Storage. Qualquer
    // outro host é renderizado como <img> simples por ProductImage, para
    // que um URL externo inválido não derrube a página.
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "**.supabase.in" },
    ],
  },
  turbopack: {
    // Sem isto o Turbopack procura a raiz do workspace a partir do git e, no
    // monorepo, encontra o package-lock.json da raiz — que não é o deste site.
    // Fixar a raiz em apps/web torna o build igual na máquina e no Netlify.
    root: path.resolve("."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
