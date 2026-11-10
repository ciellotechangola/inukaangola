"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, Pin, Send, Trash2 } from "lucide-react";
import { publicarConteudo, TIPOS, type TipoConteudo } from "@/lib/conteudos";
import type { Provincia } from "@/lib/provincias";

/**
 * Formulário de uma publicação — comunicado, promoção, testemunho ou formação.
 *
 * O tipo decide onde a publicação aparece, e é a única coisa que a gestão não
 * pode mudar depois sem republicar: um comunicado é da equipa, um testemunho é
 * do cliente. Por isso vem escolhido no topo, com o destino escrito ao lado.
 *
 * A imagem é lida no browser e vai como data URL — `publicarConteudo` trata de
 * a carregar para o bucket e de guardar o caminho, para que substituir a
 * fotografia mais tarde apague a antiga em vez de deixar lixo.
 *
 * O limite de 6 MB é do lado de cá de propósito: sem ele, uma foto de telemóvel
 * de 12 MB ficava a subir para só falhar no fim.
 */

const LIMITE_MB = 6;

/** Para onde vai quem publica, por tipo. */
const DEPOIS: Record<TipoConteudo, string> = {
  comunicado: "/vendedor/comunicados",
  promocao: "/cliente/conteudo",
  testemunho: "/cliente/conteudo",
  formacao: "/vendedor/formacao",
};

const EXEMPLO: Record<TipoConteudo, string> = {
  comunicado: "Ex.: Nova tabela de preços a partir de segunda",
  promocao: "Ex.: 20% em toda a linha de cuidados faciais",
  testemunho: "Ex.: A minha pele mudou em três meses",
  formacao: "Ex.: Como apresentar o catálogo em cinco minutos",
};

const AUTOR: Record<TipoConteudo, { rotulo: string; exemplo: string }> = {
  comunicado: { rotulo: "Assina (opcional)", exemplo: "Direcção comercial" },
  promocao: { rotulo: "Assina (opcional)", exemplo: "INUKA Angola" },
  testemunho: { rotulo: "Quem deu o testemunho", exemplo: "Dona Maria, Uíge" },
  formacao: { rotulo: "Assina (opcional)", exemplo: "Equipa de formação" },
};

export function FormularioConteudo({
  provincias,
  inicial = "comunicado",
}: {
  provincias: Provincia[];
  inicial?: TipoConteudo;
}) {
  const router = useRouter();
  const ficheiro = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<TipoConteudo>(inicial);
  const [titulo, setTitulo] = useState("");
  const [sub, setSub] = useState("");
  const [corpo, setCorpo] = useState("");
  const [autor, setAutor] = useState("");
  const [imagem, setImagem] = useState<string | null>(null);
  const [importante, setImportante] = useState(false);
  const [provincia, setProvincia] = useState("");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [erro, setErro] = useState("");
  const [aGravar, setAGravar] = useState<"publicado" | "rascunho" | null>(null);

  function escolherFicheiro(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;

    if (!f.type.startsWith("image/")) {
      setErro("O ficheiro tem de ser uma imagem (JPG, PNG ou WebP).");
      return;
    }
    if (f.size > LIMITE_MB * 1024 * 1024) {
      setErro(
        `A imagem tem ${(f.size / (1024 * 1024)).toFixed(1)} MB. O máximo é ${LIMITE_MB} MB — reduza antes de publicar.`
      );
      return;
    }

    setErro("");
    const leitor = new FileReader();
    leitor.onload = () => setImagem(typeof leitor.result === "string" ? leitor.result : null);
    leitor.readAsDataURL(f);
  }

  async function gravar(status: "publicado" | "rascunho") {
    setErro("");

    if (titulo.trim().length < 4) {
      setErro("Escreva um título com pelo menos 4 caracteres.");
      return;
    }
    if (kind === "testemunho" && !autor.trim()) {
      setErro("Escreva o nome de quem deu o testemunho — é o que aparece no cartão.");
      return;
    }
    if (inicio && fim && fim < inicio) {
      setErro("A promoção não pode terminar antes de começar.");
      return;
    }

    setAGravar(status);
    try {
      await publicarConteudo({
        kind,
        title: titulo,
        subtitle: sub || null,
        body: corpo || null,
        status,
        author_name: autor || null,
        provincia_id: provincia || null,
        is_pinned: importante,
        // O campo de data devolve `AAAA-MM-DD`; o dia escolhido começa às 00:00
        // locais e o último termina às 23:59, senão uma promoção de um dia só
        // nascia já terminada.
        starts_at: inicio ? new Date(`${inicio}T00:00:00`).toISOString() : null,
        ends_at: fim ? new Date(`${fim}T23:59:59`).toISOString() : null,
        imagem,
      });

      // Publicado → vai ver como ficou. Rascunho → volta à lista.
      if (status === "publicado") {
        router.push(DEPOIS[kind]);
      } else {
        router.push("/gerente/conteudos");
      }
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar a publicação.");
      setAGravar(null);
    }
  }

  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-5 sm:p-6">
      {erro && (
        <div className="mb-4 rounded-lg border border-[#4A2020] bg-[#2A1010] p-3 text-sm text-[#F87171]">
          {erro}
        </div>
      )}

      {/* ---------- tipo ---------- */}
      <p className="mb-2 text-[10px] uppercase tracking-wider text-[#6F6F6F]">Tipo</p>
      <div className="mb-1 flex flex-wrap gap-2">
        {TIPOS.map((t) => {
          const activo = kind === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setKind(t.key)}
              aria-pressed={activo}
              className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                activo
                  ? "border-[#C9A962] bg-[#1D1A12] text-[#C9A962]"
                  : "border-[#333] text-[#A3A3A3] hover:border-[#C9A962]/50 hover:text-[#C9A962]"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <p className="mb-5 text-[11px] text-[#6F6F6F]">
        {TIPOS.find((t) => t.key === kind)?.descricao}
      </p>

      <label className="mb-1 block text-[10px] uppercase tracking-wider text-[#6F6F6F]">
        Título *
      </label>
      <input
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        placeholder={EXEMPLO[kind]}
        maxLength={140}
        className="mb-4 w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2.5 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
      />

      <label className="mb-1 block text-[10px] uppercase tracking-wider text-[#6F6F6F]">
        Linha de apoio (opcional)
      </label>
      <input
        value={sub}
        onChange={(e) => setSub(e.target.value)}
        placeholder="Uma frase que resume a publicação"
        maxLength={140}
        className="mb-4 w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2.5 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
      />

      <label className="mb-1 block text-[10px] uppercase tracking-wider text-[#6F6F6F]">
        {AUTOR[kind].rotulo}
      </label>
      <input
        value={autor}
        onChange={(e) => setAutor(e.target.value)}
        placeholder={AUTOR[kind].exemplo}
        maxLength={80}
        className="mb-4 w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2.5 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
      />

      <label className="mb-1 block text-[10px] uppercase tracking-wider text-[#6F6F6F]">
        Mensagem
      </label>
      <textarea
        value={corpo}
        onChange={(e) => setCorpo(e.target.value)}
        rows={7}
        placeholder="Escreva aqui. As quebras de linha são respeitadas no feed."
        className="mb-4 w-full resize-y rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2.5 text-sm leading-relaxed text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
      />

      {/* ---------- imagem ---------- */}
      <p className="mb-2 block text-[10px] uppercase tracking-wider text-[#6F6F6F]">
        Imagem (opcional)
      </p>

      {imagem ? (
        <div className="mb-4 overflow-hidden rounded-lg border border-[#2A2A2A] bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imagem} alt="Pré-visualização" className="mx-auto max-h-72 object-contain" />
          <div className="flex items-center justify-between gap-2 border-t border-[#2A2A2A] bg-[#141414] px-3 py-2">
            <span className="text-[11px] text-[#6F6F6F]">
              É assim que aparece no topo do cartão.
            </span>
            <button
              type="button"
              onClick={() => {
                setImagem(null);
                if (ficheiro.current) ficheiro.current.value = "";
              }}
              className="flex items-center gap-1.5 text-[11px] text-[#A3A3A3] transition hover:text-[#DC2626]"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remover
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => ficheiro.current?.click()}
          className="mb-4 flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-[#3A3A3A] bg-[#141414] px-4 py-8 text-center transition hover:border-[#C9A962]/60"
        >
          <ImagePlus className="h-6 w-6 text-[#5F5F5F]" />
          <span className="text-sm text-[#A3A3A3]">Escolher uma imagem</span>
          <span className="text-[11px] text-[#525252]">
            JPG, PNG ou WebP · até {LIMITE_MB} MB
          </span>
        </button>
      )}

      <input
        ref={ficheiro}
        type="file"
        accept="image/*"
        onChange={escolherFicheiro}
        className="hidden"
      />

      {/* ---------- opções ---------- */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-[#6F6F6F]">
            Província
          </label>
          <select
            value={provincia}
            onChange={(e) => setProvincia(e.target.value)}
            className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2.5 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
          >
            <option value="">Todas (nacional)</option>
            {provincias.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </div>

        <label className="flex cursor-pointer items-center gap-2 self-end rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2.5">
          <input
            type="checkbox"
            checked={importante}
            onChange={(e) => setImportante(e.target.checked)}
            className="h-4 w-4 accent-[#C9A962]"
          />
          <span className="flex items-center gap-1.5 text-sm text-[#F5F5F5]">
            <Pin className="h-3.5 w-3.5 text-[#C9A962]" /> Fixar no topo
          </span>
        </label>
      </div>

      {/* As datas só fazem sentido numa promoção: é o que a loja usa para a
          mostrar e para a retirar sozinha. */}
      {kind === "promocao" && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-[#6F6F6F]">
              Começa em (opcional)
            </label>
            <input
              type="date"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
              className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2.5 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wider text-[#6F6F6F]">
              Termina em (opcional)
            </label>
            <input
              type="date"
              value={fim}
              onChange={(e) => setFim(e.target.value)}
              className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2.5 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
            />
          </div>
          <p className="text-[11px] text-[#5F5F5F] sm:col-span-2">
            Sem datas, a promoção fica em curso até ser suspensa.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-3 border-t border-[#262626] pt-4">
        <button
          type="button"
          onClick={() => gravar("publicado")}
          disabled={aGravar !== null}
          className="inline-flex items-center gap-2 rounded-lg bg-[#C9A962] px-5 py-2.5 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-60"
        >
          {aGravar === "publicado" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {aGravar === "publicado" ? "A publicar…" : "Publicar agora"}
        </button>

        <button
          type="button"
          onClick={() => gravar("rascunho")}
          disabled={aGravar !== null}
          className="inline-flex items-center gap-2 rounded-lg border border-[#404040] px-5 py-2.5 text-sm text-[#F5F5F5] transition hover:border-[#C9A962] hover:text-[#C9A962] disabled:opacity-60"
        >
          {aGravar === "rascunho" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {aGravar === "rascunho" ? "A guardar…" : "Guardar rascunho"}
        </button>
      </div>
    </div>
  );
}
