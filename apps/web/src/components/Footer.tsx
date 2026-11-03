import Link from "next/link";

export default function Footer() {
  const year = 2026;
  return (
    <footer className="border-t border-[#262626] bg-[#0A0A0A] px-4 py-10">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 sm:flex-row">
        <p className="text-sm text-[#A3A3A3]">
          © {year} INUKA Angola. Todos os direitos reservados.
        </p>
        <div className="flex flex-wrap justify-center gap-6 text-sm text-[#A3A3A3]">
          <Link href="/promocoes" className="hover:text-[#C9A962]">Promoções</Link>
          <Link href="/sobre" className="hover:text-[#C9A962]">Sobre</Link>
          <Link href="/contactos" className="hover:text-[#C9A962]">Contactos</Link>
          <Link href="/privacidade" className="hover:text-[#C9A962]">Privacidade</Link>
        </div>
      </div>
    </footer>
  );
}
