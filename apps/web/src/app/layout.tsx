import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { CartProvider } from "@/components/cart-context";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

/** [ficheiro, largura CSS, altura CSS, densidade] de cada iPhone suportado. */
const ARRANQUE: [string, number, number, number][] = [
  ["splash-828x1792.png", 414, 896, 2], // XR, 11
  ["splash-1170x2532.png", 390, 844, 3], // 12, 13, 14
  ["splash-1125x2436.png", 375, 812, 3], // X, XS, 11 Pro, mini
  ["splash-1242x2688.png", 414, 896, 3], // XS Max, 11 Pro Max
  ["splash-1179x2556.png", 393, 852, 3], // 14 Pro, 15, 16
  ["splash-1206x2622.png", 402, 874, 3], // 16 Pro
  ["splash-1290x2796.png", 430, 932, 3], // Pro Max, 17, 18
];

export const metadata: Metadata = {
  title: "INUKA Angola",
  description: "Plataforma oficial de produtos INUKA em Angola",
  manifest: "/manifest.json",
  applicationName: "INUKA",
  // "Adicionar ao ecrã principal" no iPhone: sem `capable` o iOS abre o Safari
  // com barra de endereço em vez de uma app; sem `title` fica o título da
  // página, que é comprido debaixo do ícone.
  appleWebApp: {
    capable: true,
    title: "INUKA",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/ios/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/ios/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    // O iOS ignora os ícones do manifest — só olha para este.
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = {
  themeColor: "#C9A962",
  width: "device-width",
  initialScale: 1,
  // Sem isto, o iPhone desenha a página por baixo do entalhe e da barra de
  // gestos: `env(safe-area-inset-*)` fica a zero e o último botão desaparece.
  viewportFit: "cover",
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt" className={`${inter.variable} h-full antialiased`}>
      {/* O `metadata` do Next não expõe `apple-touch-startup-image`, por isso
          os ecrãs de arranque vão à mão. Sem eles o iPhone mostra um flash
          branco entre o toque no ícone e a primeira página. */}
      <head>
        {/* O Next 16 emite só `mobile-web-app-capable` (o nome standard). O
            Safari do iPhone exige o nome com prefixo Apple para arrancar em
            ecrã inteiro a partir do ícone; sem ele abre o Safari com barra de
            endereço, embora o `display: standalone` do manifesto ajude nas
            versões mais recentes. Custa uma linha e cobre os telefones que
            ainda não estão actualizados. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />

        {ARRANQUE.map(([imagem, largura, altura, ratio]) => (
          <link
            key={imagem}
            rel="apple-touch-startup-image"
            href={`/ios/${imagem}`}
            media={`(device-width: ${largura}px) and (device-height: ${altura}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)`}
          />
        ))}
      </head>
      <body className="min-h-full flex flex-col bg-[#0A0A0A] text-[#F5F5F5]">
        <CartProvider>{children}</CartProvider>
      </body>
    </html>
  );
}
