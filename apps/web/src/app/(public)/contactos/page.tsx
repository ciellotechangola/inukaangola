import Link from "next/link";
import { Mail, MessageCircle, Phone } from "lucide-react";
import { telHref, whatsappHref, mailHref } from "@/lib/contactos";
import { lerDefinicoes } from "@/lib/definicoes-server";

export const dynamic = "force-dynamic";

export default async function ContactosPage() {
  // Os contactos vêm das definições que a gerência edita em
  // `/gerente/definicoes`; o que está em `lib/contactos.ts` é só a origem.
  const defs = await lerDefinicoes();
  const telefones = defs.telefones;

  return (
    <main className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-3xl font-light tracking-tight text-[#F5F5F5] sm:text-4xl">Contactos</h1>
      <p className="mt-3 text-sm leading-relaxed text-[#A3A3A3]">
        Estamos aqui para ajudar. Escolha o canal que preferir.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="group rounded-xl border border-[#262626] bg-[#141414] p-6 transition hover:border-[#C9A962]/50">
          <Phone className="h-5 w-5 text-[#C9A962]" />
          <p className="mt-3 text-sm font-medium text-[#E5E5E5]">Apoio ao cliente</p>
          {telefones.map((t) => (
            <a
              key={t}
              href={telHref(t)}
              className="mt-1 block text-[#C9A962] transition hover:text-[#E3D5A7]"
            >
              {t}
            </a>
          ))}
          <p className="mt-1 text-xs text-[#6F6F6F]">Segunda a sábado, 8h–18h</p>
        </div>

        <div className="group rounded-xl border border-[#262626] bg-[#141414] p-6 transition hover:border-[#C9A962]/50">
          <MessageCircle className="h-5 w-5 text-[#C9A962]" />
          <p className="mt-3 text-sm font-medium text-[#E5E5E5]">WhatsApp</p>
          {telefones.map((t) => (
            <a
              key={t}
              href={whatsappHref(t)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block text-[#C9A962] transition hover:text-[#E3D5A7]"
            >
              {t}
            </a>
          ))}
          <p className="mt-1 text-xs text-[#6F6F6F]">Encomendas e dúvidas rápidas</p>
        </div>

        <a
          href={mailHref(defs.email)}
          className="group rounded-xl border border-[#262626] bg-[#141414] p-6 transition hover:border-[#C9A962]/50"
        >
          <Mail className="h-5 w-5 text-[#C9A962]" />
          <p className="mt-3 text-sm font-medium text-[#E5E5E5]">E-mail</p>
          <p className="mt-1 break-all text-[#C9A962]">{defs.email}</p>
          <p className="mt-1 text-xs text-[#6F6F6F]">Resposta em até 48 horas</p>
        </a>

        <div className="rounded-xl border border-[#262626] bg-[#141414] p-6">
          <p className="text-sm font-medium text-[#E5E5E5]">Quero ser colaborador</p>
          <p className="mt-2 text-sm leading-relaxed text-[#A3A3A3]">
            Para se tornar colaborador autorizado INUKA, fale com a gerência pelo telefone ou
            WhatsApp indicados.
          </p>
        </div>
      </div>

      <p className="mt-8 text-xs leading-relaxed text-[#525252]">
        Ao contactar-nos está a aceitar que guardemos o essencial para responder ao seu pedido.
        Veja como tratamos os seus dados na{" "}
        <Link href="/privacidade" className="text-[#C9A962] underline-offset-4 hover:underline">
          política de privacidade
        </Link>
        .
      </p>
    </main>
  );
}
