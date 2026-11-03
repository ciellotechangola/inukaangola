"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { iniciais } from "@/lib/colaborador";

const BUCKET = "avatars";
const MAX_BYTES = 3 * 1024 * 1024;

/**
 * Fotografia de perfil de um colaborador ou cliente.
 *
 * O bucket `avatars` é público para leitura e a escrita só é permitida na
 * pasta do próprio (`avatars/<uuid>/…`) ou a um gestor — por isso a fotografia
 * de outra pessoa só pode ser mudada por quem gere.
 */
export default function FotoPerfil({
  userId,
  nome,
  url,
  podeEditar = false,
  compacto = false,
}: {
  userId: string;
  nome: string;
  url: string | null;
  podeEditar?: boolean;
  compacto?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [previa, setPrevia] = useState<string | null>(null);

  const dimensao = compacto ? "h-9 w-9" : "h-20 w-20";
  const texto = compacto ? "text-[10px]" : "text-lg";

  async function escolher(ficheiro: File) {
    setErro("");

    if (!ficheiro.type.startsWith("image/")) {
      setErro("Escolha uma imagem.");
      return;
    }
    if (ficheiro.size > MAX_BYTES) {
      setErro("A imagem não pode passar de 3 MB.");
      return;
    }

    setOcupado(true);
    // Pré-visualização imediata: o upload pode demorar numa ligação lenta.
    setPrevia(URL.createObjectURL(ficheiro));

    const supabase = createClientBrowser();
    const extensao = (ficheiro.name.split(".").pop() || "jpg").toLowerCase();
    const caminho = `${userId}/${crypto.randomUUID()}.${extensao}`;

    const { error: erroUpload } = await supabase.storage
      .from(BUCKET)
      .upload(caminho, ficheiro, { contentType: ficheiro.type, upsert: false });

    if (erroUpload) {
      setOcupado(false);
      setPrevia(null);
      setErro(
        erroUpload.message.includes("row-level security")
          ? "Sem permissão para alterar esta fotografia."
          : erroUpload.message
      );
      return;
    }

    const { data: publico } = supabase.storage.from(BUCKET).getPublicUrl(caminho);

    const { error: erroPerfil } = await supabase
      .from("profiles")
      .update({ avatar_url: publico.publicUrl })
      .eq("id", userId);

    if (erroPerfil) {
      setOcupado(false);
      setPrevia(null);
      setErro(erroPerfil.message);
      // A fotografia ficou no bucket sem ninguém a apontar para ela.
      await supabase.storage.from(BUCKET).remove([caminho]);
      return;
    }

    // Limpar a anterior, se era deste bucket (um URL externo não se apaga).
    const anterior = caminhoNoBucket(url);
    if (anterior && anterior !== caminho) {
      await supabase.storage.from(BUCKET).remove([anterior]);
    }

    setOcupado(false);
    setPrevia(null);
    router.refresh();
  }

  async function remover() {
    if (!window.confirm("Remover a fotografia?")) return;

    setOcupado(true);
    setErro("");
    const supabase = createClientBrowser();

    const { error } = await supabase.from("profiles").update({ avatar_url: null }).eq("id", userId);
    if (error) {
      setOcupado(false);
      setErro(error.message);
      return;
    }

    const anterior = caminhoNoBucket(url);
    if (anterior) await supabase.storage.from(BUCKET).remove([anterior]);

    setOcupado(false);
    router.refresh();
  }

  const mostrar = previa ?? url;

  return (
    <div className={compacto ? "flex items-center gap-2" : "flex flex-col items-center gap-2"}>
      <div className={`group relative ${dimensao} shrink-0`}>
        <div
          className={`flex ${dimensao} items-center justify-center overflow-hidden rounded-full border border-[#C9A962]/40 bg-[#0A0A0A]`}
        >
          {mostrar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mostrar} alt={nome} className="h-full w-full object-cover" />
          ) : (
            <span className={`${texto} font-medium tracking-wide text-[#C9A962]`}>
              {iniciais(nome)}
            </span>
          )}
        </div>

        {podeEditar && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={ocupado}
            aria-label="Alterar fotografia"
            className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border border-[#333] bg-[#1A1A1A] text-[#A3A3A3] transition hover:border-[#C9A962] hover:text-[#C9A962] disabled:opacity-50"
          >
            {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
          </button>
        )}
      </div>

      {podeEditar && !compacto && (
        <div className="flex items-center gap-3 text-[11px]">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={ocupado}
            className="text-[#6F6F6F] transition hover:text-[#C9A962] disabled:opacity-50"
          >
            {url ? "Trocar fotografia" : "Carregar fotografia"}
          </button>
          {url && (
            <button
              type="button"
              onClick={remover}
              disabled={ocupado}
              className="inline-flex items-center gap-1 text-[#6F6F6F] transition hover:text-[#DC2626] disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" />
              remover
            </button>
          )}
        </div>
      )}

      {podeEditar && compacto && url && (
        <button
          type="button"
          onClick={remover}
          disabled={ocupado}
          aria-label="Remover fotografia"
          className="text-[#525252] transition hover:text-[#DC2626] disabled:opacity-50"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}

      {erro && (
        <p className={`text-[11px] text-[#F87171] ${compacto ? "max-w-[140px]" : "text-center"}`}>
          {erro}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const ficheiro = e.target.files?.[0];
          e.target.value = "";
          if (ficheiro) escolher(ficheiro);
        }}
      />
    </div>
  );
}

/** `…/storage/v1/object/public/avatars/<uuid>/<ficheiro>` → `<uuid>/<ficheiro>`. */
function caminhoNoBucket(url: string | null): string | null {
  if (!url) return null;
  const marcador = `/object/public/${BUCKET}/`;
  const i = url.indexOf(marcador);
  return i === -1 ? null : decodeURIComponent(url.slice(i + marcador.length));
}
