"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, X, ShoppingBag, User, LogOut } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { useCart } from "@/components/cart-context";
import type { Profile, Provincia } from "@/types";

export default function Header() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [provincia, setProvincia] = useState<Provincia | null>(null);
  const [loading, setLoading] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { count, ready } = useCart();

  useEffect(() => {
    const supabase = createClientBrowser();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        setLoading(false);
        return;
      }
      // A província vem embutida: `profiles.provincia_id` tem chave estrangeira
      // para `provincias`, por isso o PostgREST consegue resolver o embutido.
      supabase
        .from("profiles")
        .select("*, provincia:provincias(nome, codigo, delegacao_nome)")
        .eq("id", user.id)
        .single()
        .then(({ data }) => {
          const linha = data as (Profile & { provincia: Provincia | null }) | null;
          if (linha) {
            const { provincia: prov, ...resto } = linha;
            setProfile(resto as Profile);
            setProvincia(prov ?? null);
          }
          setLoading(false);
        });
    });

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      router.refresh();
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  async function handleSignOut() {
    const supabase = createClientBrowser();
    await supabase.auth.signOut();
    setProfile(null);
    setProvincia(null);
    router.push("/");
    router.refresh();
  }

  // `desde` adia a ligação para ecrãs largos: com as áreas novas (conteúdos e
  // formação) o menu passava a não caber a partir de 768 px.
  const navLinks: { href: string; label: string; desde?: "md" | "lg" }[] = [
    { href: "/catalogo", label: "Catálogo" },
    // Descarregar fica junto ao catálogo: é a segunda coisa que um visitante
    // procura depois de ver os produtos — ter a app no telemóvel.
    { href: "/download", label: "Descarregar", desde: "md" },
    // Pedidos fica logo a seguir ao catálogo: é a página que o cliente e a
    // gestão abrem todos os dias. Cada perfil vê a que lhe compete — o cliente
    // os seus, o gestor os de toda a operação.
    ...(profile?.role === "customer"
      ? [
          { href: "/cliente/encomendas", label: "Pedidos" },
          // Compras = o que um colaborador registou em nome deste número,
          // incluindo antes de a conta existir.
          { href: "/cliente/compras", label: "Compras" },
          { href: "/cliente/conteudo", label: "Notícias" },
        ]
      : []),
    // O estúdio de design é ferramenta de gestão: não aparece ao cliente nem
    // ao colaborador.
    ...(profile?.role === "manager"
      ? [
          { href: "/gerente/encomendas", label: "Pedidos" },
          { href: "/designer", label: "Designer" },
          { href: "/gerente/conteudos", label: "Conteúdos" },
          { href: "/gerente/formacao", label: "Formação" },
          { href: "/gerente/perfis", label: "Perfis" },
        ]
      : []),
    ...(profile?.role === "seller"
      ? [
          { href: "/vendedor/comunicados", label: "Comunicados" },
          { href: "/vendedor/formacao", label: "Formação" },
        ]
      : []),
    // A loja tem o seu próprio menu: stock e balcão são o dia-a-dia.
    ...(profile?.role === "store_seller"
      ? [
          { href: "/loja", label: "Loja" },
          { href: "/loja/stock", label: "Stock" },
          { href: "/loja/vendas", label: "Vendas" },
          { href: "/loja/encomendas", label: "Encomendas" },
        ]
      : []),
    // O colaborador vê a referência no cartão de identidade da Área de
    // Colaborador — uma vez, e com o botão de copiar. A aba «Referência» fica
    // para clientes e gestão, que não têm esse cartão.
    ...(profile && profile.role !== "seller" ? [{ href: "/referencia", label: "Referência" }] : []),
    ...(profile ? [{ href: "/conversas", label: "Mensagens" }] : []),
    { href: "/sobre", label: "Sobre", desde: "lg" },
    // «Ser colaborador» é a porta de quem ainda não trabalha na INUKA. Quem já
    // é colaborador, loja ou gestão não precisa dela — e não a vê.
    ...(profile?.role === "seller" || profile?.role === "store_seller" || profile?.role === "manager"
      ? []
      : [{ href: "/revendedor", label: "Ser colaborador", desde: "md" as const }]),
    { href: "/contactos", label: "Contactos", desde: "lg" },
  ];

  const dashboardLink = profile
    ? profile.role === "manager"
      ? "/gerente"
      : profile.role === "store_seller"
        ? "/loja"
        : profile.role === "seller"
          ? "/vendedor"
          : "/cliente"
    : "/login";

  return (
    <header className="sticky top-0 z-50 border-b border-[#262626] bg-[#0A0A0A]/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/logo-inuka.png" alt="INUKA" width={80} height={40} className="h-8 w-auto" />
          <span className="hidden font-light tracking-wide text-[#C9A962] sm:inline">Angola</span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-sm font-medium text-[#A3A3A3] transition hover:text-[#C9A962] ${
                link.desde === "lg" ? "hidden lg:inline" : link.desde === "md" ? "hidden md:inline" : ""
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-4 md:flex">
          <Link
            href="/carrinho"
            className="relative text-[#A3A3A3] transition hover:text-[#C9A962]"
            aria-label="Carrinho"
          >
            <ShoppingBag className="h-5 w-5" />
            {ready && count > 0 && (
              <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#C9A962] px-1 text-[11px] font-semibold text-[#0A0A0A]">
                {count}
              </span>
            )}
          </Link>

          {profile ? (
            <div className="flex items-center gap-3">
              <Link
                href={dashboardLink}
                className="inline-flex items-center gap-2 rounded-lg border border-[#404040] px-4 py-2 text-sm font-medium text-[#F5F5F5] transition hover:border-[#C9A962] hover:text-[#C9A962]"
              >
                <User className="h-4 w-4" />
                {profile.full_name.split(" ")[0]}
              </Link>
              <button
                onClick={handleSignOut}
                className="text-[#A3A3A3] transition hover:text-[#DC2626]"
                aria-label="Terminar sessão"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-lg border border-[#404040] px-4 py-2 text-sm font-medium text-[#F5F5F5] transition hover:border-[#C9A962] hover:text-[#C9A962]"
            >
              <User className="h-4 w-4" />
              {loading ? "..." : "Entrar"}
            </Link>
          )}
        </div>

        <div className="flex items-center gap-1 md:hidden">
          {/* No telemóvel o carrinho fica sempre à vista: é o que mais se usa. */}
          <Link
            href="/carrinho"
            className="relative flex h-10 w-10 items-center justify-center text-[#A3A3A3] transition hover:text-[#C9A962]"
            aria-label={ready && count > 0 ? `Carrinho, ${count} artigos` : "Carrinho"}
          >
            <ShoppingBag className="h-5 w-5" />
            {ready && count > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#C9A962] px-1 text-[10px] font-semibold text-[#0A0A0A]">
                {count}
              </span>
            )}
          </Link>

          <button
            className="flex h-10 w-10 items-center justify-center text-[#F5F5F5]"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? "Fechar menu" : "Abrir menu"}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Identidade provincial: marca + província + colaborador + delegação.
          Só aparece depois de iniciar sessão. */}
      {profile && (
        <div className="border-t border-[#1C1C1C] bg-[#0D0D0D]">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-1.5 text-[11px] uppercase tracking-[0.12em]">
            <span className="text-[#C9A962]">INUKA Angola</span>
            <span className="text-[#333]">·</span>
            <span className="text-[#E5E5E5]">{provincia?.nome ?? "Nacional"}</span>
            {/* No telemóvel a barra fica só com o essencial: três linhas de
                texto empurravam o conteúdo para baixo. */}
            <span className="hidden text-[#333] sm:inline">·</span>
            <span className="hidden text-[#8A8A8A] sm:inline">
              {provincia?.delegacao_nome ?? "Administração nacional"}
            </span>
            <span className="hidden text-[#333] sm:inline">·</span>
            <span className="hidden text-[#8A8A8A] sm:inline">{profile.full_name}</span>
            {/* A referência não se repete aqui: o colaborador vê-a no cartão da
                Área de Colaborador e os restantes na aba «Referência». Um
                código em cada canto deixava de ser um código de referência. */}
          </div>
        </div>
      )}

      {mobileOpen && (
        <div className="border-t border-[#262626] bg-[#1A1A1A] px-4 py-4 md:hidden">
          <nav className="flex flex-col gap-4">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-[#A3A3A3] transition hover:text-[#C9A962]"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/carrinho"
              className="text-[#A3A3A3] transition hover:text-[#C9A962]"
              onClick={() => setMobileOpen(false)}
            >
              Carrinho {ready && count > 0 ? `(${count})` : ""}
            </Link>
            <Link
              href={dashboardLink}
              className="inline-flex items-center gap-2 text-[#C9A962]"
              onClick={() => setMobileOpen(false)}
            >
              <User className="h-4 w-4" />
              {profile ? "A minha conta" : "Entrar"}
            </Link>
            {profile && (
              <button onClick={handleSignOut} className="text-left text-[#DC2626]">
                Terminar sessão
              </button>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
