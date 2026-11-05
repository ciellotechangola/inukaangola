import Link from "next/link";
import { EMAIL_INUKA, mailHref } from "@/lib/contactos";

export default function Footer() {
  const year = 2026;
  return (
    <footer className="border-t border-[#262626] bg-[#0A0A0A] px-4 py-10">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 sm:flex-row">
        <div className="text-center sm:text-left">
          <p className="text-sm text-[#A3A3A3]">
            © {year} INUKA Angola. Todos os direitos reservados.
          </p>
          <a
            href={mailHref()}
            className="mt-1 inline-block text-xs text-[#6F6F6F] transition hover:text-[#C9A962]"
          >
            {EMAIL_INUKA}
          </a>
        </div>
        <div className="flex flex-wrap justify-center gap-6 text-sm text-[#A3A3A3]">
          <Link href="/promocoes" className="hover:text-[#C9A962]">Promoções</Link>
          <Link href="/download" className="hover:text-[#C9A962]">Descarregar app</Link>
          <Link href="/sobre" className="hover:text-[#C9A962]">Sobre</Link>
          <Link href="/contactos" className="hover:text-[#C9A962]">Contactos</Link>
          <Link href="/privacidade" className="hover:text-[#C9A962]">Privacidade</Link>
        </div>
      </div>
    </footer>
  );
}
