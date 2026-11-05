import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { lerDefinicoes } from "@/lib/definicoes-server";
import FormularioDefinicoes from "./FormularioDefinicoes";

export const dynamic = "force-dynamic";

/**
 * Definições da loja.
 *
 * Existe por uma razão simples: o e-mail de atendimento e o link da aplicação
 * mudam sem aviso — um Gmail novo, um APK recompilado, um TestFlight que
 * expira. Antes isso obrigava a mexer no código e a publicar de novo; agora a
 * gerência muda aqui e a loja apanha na hora.
 */
export default async function DefinicoesPage() {
  const perfil = await getProfile();
  if (!perfil || perfil.role !== "manager") redirect("/");

  const definicoes = await lerDefinicoes();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/gerente" className="mb-6 inline-block text-sm text-[#A3A3A3] hover:text-[#C9A962]">
        ← Painel de gestão
      </Link>

      <div className="mb-6">
        <h1 className="text-3xl font-light text-[#F5F5F5]">Definições</h1>
        <p className="mt-1 text-sm text-[#A3A3A3]">
          Contactos públicos e aplicações para descarregar. O que gravar aqui aparece na loja de
          imediato — sem publicar nada.
        </p>
      </div>

      <FormularioDefinicoes iniciais={definicoes} />

      <p className="mt-8 text-xs leading-relaxed text-[#525252]">
        Os valores ficam em <code className="text-[#6F6F6F]">platform_settings</code>, chave{" "}
        <code className="text-[#6F6F6F]">loja</code>. Um link de partilha do Google Drive é
        convertido automaticamente em descarga directa: quem clica recebe o ficheiro, não uma
        pré-visualização com outro botão.
        {definicoes.actualizadoEm && (
          <>
            {" "}
            Última alteração:{" "}
            {new Date(definicoes.actualizadoEm).toLocaleString("pt-PT", {
              dateStyle: "short",
              timeStyle: "short",
            })}
            .
          </>
        )}
      </p>
    </main>
  );
}
