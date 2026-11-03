import Link from "next/link";

export const metadata = {
  title: "Privacidade · INUKA Angola",
  description: "Como a INUKA Angola recolhe, usa e protege os dados dos seus clientes.",
};

export default function PrivacidadePage() {
  const secoes = [
    {
      titulo: "Que dados recolhemos",
      corpo: [
        "Nome, número de telefone e, quando indicado, bairro e endereço de entrega. O telefone é o identificador da sua conta.",
        "Histórico de encomendas, reservas, favoritos e mensagens trocadas com colaboradores e gerência.",
        "Não pedimos número de cartão nem dados bancários: o pagamento é combinado na entrega.",
      ],
    },
    {
      titulo: "Para que servem",
      corpo: [
        "Criar e manter a sua conta, preparar encomendas e reservar stock.",
        "Avisar sobre o estado das encomendas e responder a pedidos de apoio.",
        "Indicadores internos de vendas — sempre agregados, nunca para publicidade de terceiros.",
      ],
    },
    {
      titulo: "Quem pode ver",
      corpo: [
        "Os seus dados ficam acessíveis a si e, no âmbito do acompanhamento comercial, ao colaborador associado e à gerência.",
        "As regras de acesso são aplicadas na base de dados: cada conta só lê o que lhe pertence. Nenhum cliente consegue ver os dados de outro.",
        "Não vendemos nem cedemos dados a terceiros para marketing.",
      ],
    },
    {
      titulo: "Durante quanto tempo",
      corpo: [
        "Enquanto a conta existir. O histórico de encomendas e vendas é mantido por integridade contabilística, mesmo depois de a conta ser encerrada.",
      ],
    },
    {
      titulo: "Os seus direitos",
      corpo: [
        "Pode pedir acesso, correção ou eliminação dos seus dados, e terminar sessão em qualquer dispositivo.",
        "Para exercer estes direitos, contacte a gerência pelos meios indicados na página de contactos.",
      ],
    },
  ];

  return (
    <main className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-3xl font-light tracking-tight text-[#F5F5F5] sm:text-4xl">Privacidade</h1>
      <p className="mt-3 text-sm leading-relaxed text-[#A3A3A3]">
        Esta página explica, em linguagem simples, que dados a plataforma INUKA Angola guarda e
        para quê.
      </p>

      <div className="mt-10 space-y-8">
        {secoes.map((s) => (
          <section key={s.titulo}>
            <h2 className="mb-2 text-lg font-medium text-[#C9A962]">{s.titulo}</h2>
            <div className="space-y-2">
              {s.corpo.map((paragrafo) => (
                <p key={paragrafo} className="text-sm leading-relaxed text-[#A3A3A3]">
                  {paragrafo}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-12 rounded-xl border border-[#262626] bg-[#141414] p-6">
        <p className="text-sm text-[#A3A3A3]">
          Dúvidas sobre os seus dados?{" "}
          <Link href="/contactos" className="text-[#C9A962] underline-offset-4 hover:underline">
            Fale connosco
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
