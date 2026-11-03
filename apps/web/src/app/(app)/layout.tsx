import Header from "@/components/Header";
import Footer from "@/components/Footer";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      {/* As páginas já trazem o seu próprio <main>; um segundo aqui produziria
          dois <main> no documento (HTML inválido e leitores de ecrã confusos). */}
      <div className="flex-1">{children}</div>
      <Footer />
    </>
  );
}
