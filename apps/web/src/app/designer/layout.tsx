import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Estúdio de design · INUKA Angola",
  description: "Crie, edite e exporte os seus designs INUKA.",
};

export const dynamic = "force-dynamic";

export default function DesignerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
