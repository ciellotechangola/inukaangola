"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, Store, X } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { formatCurrency } from "@/lib/utils";
import { mensagemDeErro } from "@/lib/erros";
import {
  CAMPOS_LOJA,
  quandoLoja,
  type CampoLoja,
  type GerenteOpcao,
  type LinhaLoja,
  type ProvinciaOpcao,
} from "@/lib/lojas";

const PATCH = "supabase/PATCH_LOJAS.sql";

const ENTRADA =
  "w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none disabled:opacity-60";
const ROTULO = "mb-1 block text-[10px] uppercase tracking-wider text-[#8A8A8A]";

function texto(valor: number | null): string {
  return valor === null ? "" : String(valor);
}

/**
 * Tabela de lojas + editor da loja escolhida.
 *
 * O editor tem duas partes: os quatro valores (caixa, saldo, investimento e
 * valores a pagar) e os dados da loja (código, nome, província, gerente). O
 * automático aparece sempre ao lado do escrito — nunca é apagado.
 */
export default function GestaoLojas({
  lojas,
  provincias,
  gerentes,
  nacional,
  provinciaFixa,
}: {
  lojas: LinhaLoja[];
  provincias: ProvinciaOpcao[];
  gerentes: GerenteOpcao[];
  nacional: boolean;
  provinciaFixa: string | null;
}) {
  const router = useRouter();
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [aCriar, setACriar] = useState(false);

  const loja = lojas.find((l) => l.id === selecionada) ?? null;

  return (
    <div className="space-y-6">
      {erro && (
        <div className="rounded-lg border border-[#5A2A2A] bg-[#241010] p-3 text-sm text-[#F87171]">
          {erro}
        </div>
      )}
      {aviso && (
        <div className="rounded-lg border border-[#2A4A34] bg-[#0F1F15] p-3 text-sm text-[#5FBF8F]">
          {aviso}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[#A3A3A3]">
          {lojas.length} loja(s). Clique numa linha para ver e corrigir os valores.
        </p>
        {!aCriar && (
          <button
            type="button"
            onClick={() => {
              setACriar(true);
              setAviso("");
              setErro("");
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#C9A962]/40 px-3 py-1.5 text-xs text-[#C9A962] transition hover:bg-[#C9A962]/10"
          >
            <Plus className="h-3.5 w-3.5" /> Nova loja
          </button>
        )}
      </div>

      {aCriar && (
        <DadosLoja
          loja={null}
          provincias={provincias}
          gerentes={gerentes}
          nacional={nacional}
          provinciaFixa={provinciaFixa}
          onFechar={() => setACriar(false)}
          onFeito={(msg) => {
            setACriar(false);
            setAviso(msg);
            setErro("");
            router.refresh();
          }}
          onErro={setErro}
        />
      )}

      <div className="tabela-deslizante rounded-xl border border-[#262626]">
        <table className="w-full text-sm">
          <thead className="bg-[#141414] text-left text-[11px] uppercase tracking-wider text-[#5A5A5A]">
            <tr>
              <th className="px-4 py-3 font-normal">Loja</th>
              <th className="px-4 py-3 font-normal">Província</th>
              <th className="px-4 py-3 font-normal">Gerente</th>
              <th className="px-4 py-3 text-right font-normal">Stock</th>
              <th className="px-4 py-3 text-right font-normal">Vendas</th>
              <th className="px-4 py-3 text-right font-normal">Caixa</th>
              <th className="px-4 py-3 text-right font-normal">Saldo</th>
              <th className="px-4 py-3 text-right font-normal">Investido</th>
              <th className="px-4 py-3 text-right font-normal">A pagar</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {lojas.map((l) => (
              <tr
                key={l.id}
                className={`border-t border-[#1F1F1F] transition ${
                  selecionada === l.id ? "bg-[#1F1B10]" : "bg-[#1A1A1A] hover:bg-[#1F1F1F]"
                }`}
              >
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSelecionada(selecionada === l.id ? null : l.id);
                      setErro("");
                      setAviso("");
                    }}
                    className="flex items-center gap-2 text-left"
                  >
                    <Store className="h-3.5 w-3.5 shrink-0 text-[#C9A962]" />
                    <span>
                      <span className="block text-[#F5F5F5]">{l.nome}</span>
                      <span className="block font-mono text-[10px] text-[#525252]">
                        {l.codigo}
                        {l.is_default ? " · principal" : ""}
                        {!l.is_active ? " · inactiva" : ""}
                      </span>
                    </span>
                  </button>
                </td>
                <td className="px-4 py-3 text-[#A3A3A3]">{l.provincia ?? "—"}</td>
                <td className="px-4 py-3 text-[#A3A3A3]">{l.manager ?? "—"}</td>
                <td className="px-4 py-3 text-right text-[#A3A3A3]">{l.stock_unidades} un.</td>
                <td className="px-4 py-3 text-right text-[#C9A962]">
                  {formatCurrency(l.vendas)}
                </td>
                <td className="px-4 py-3 text-right">
                  <Valor valor={l.caixa.valor} manual={l.caixa.manual !== null} />
                </td>
                <td className="px-4 py-3 text-right">
                  <Valor valor={l.saldo.valor} manual={l.saldo.manual !== null} />
                </td>
                <td className="px-4 py-3 text-right text-[#A3A3A3]">
                  {formatCurrency(l.investimento.valor)}
                </td>
                <td className="px-4 py-3 text-right text-[#A3A3A3]">
                  {formatCurrency(l.valores_a_pagar.valor)}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setSelecionada(selecionada === l.id ? null : l.id);
                      setErro("");
                      setAviso("");
                    }}
                    className="inline-flex items-center gap-1 text-[11px] text-[#8A8A8A] hover:text-[#C9A962]"
                  >
                    <Pencil className="h-3 w-3" /> Abrir
                  </button>
                </td>
              </tr>
            ))}
            {lojas.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-[#8A8A8A]">
                  Ainda não há lojas nesta província.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {loja && (
        <EditorLoja
          key={loja.id}
          loja={loja}
          provincias={provincias}
          gerentes={gerentes}
          nacional={nacional}
          provinciaFixa={provinciaFixa}
          onFechar={() => setSelecionada(null)}
          onFeito={(msg) => {
            setAviso(msg);
            setErro("");
            router.refresh();
          }}
          onErro={setErro}
        />
      )}
    </div>
  );
}

function Valor({ valor, manual }: { valor: number; manual: boolean }) {
  return (
    <span className={manual ? "text-[#C9A962]" : "text-[#A3A3A3]"}>
      {formatCurrency(valor)}
      {manual && <span className="ml-1 text-[9px] uppercase text-[#6F6F6F]">escrito</span>}
    </span>
  );
}

/** Os quatro valores da loja. */
function EditorLoja({
  loja,
  provincias,
  gerentes,
  nacional,
  provinciaFixa,
  onFechar,
  onFeito,
  onErro,
}: {
  loja: LinhaLoja;
  provincias: ProvinciaOpcao[];
  gerentes: GerenteOpcao[];
  nacional: boolean;
  provinciaFixa: string | null;
  onFechar: () => void;
  onFeito: (msg: string) => void;
  onErro: (msg: string) => void;
}) {
  const router = useRouter();
  const [valores, setValores] = useState<Record<CampoLoja, string>>({
    caixa: texto(loja.caixa.manual),
    saldo: texto(loja.saldo.manual),
    investimento: texto(loja.investimento.manual),
    valores_a_pagar: texto(loja.valores_a_pagar.manual),
  });
  const [nota, setNota] = useState(loja.nota ?? "");
  const [aGravar, setAGravar] = useState(false);
  const [aEditarDados, setAEditarDados] = useState(false);

  const porGuardar = CAMPOS_LOJA.some((c) => {
    const escrito = (valores[c.chave] ?? "").trim();
    const manual = loja[c.chave].manual;
    return escrito !== texto(manual);
  });

  function definir(campo: CampoLoja, valor: string) {
    setValores((v) => ({ ...v, [campo]: valor }));
  }

  function usarAutomatico(campo: CampoLoja) {
    definir(campo, "");
  }

  function copiarAutomatico(campo: CampoLoja) {
    definir(campo, String(loja[campo].automatico));
  }

  async function guardar() {
    setAGravar(true);
    onErro("");
    const supabase = createClientBrowser();
    const payload: Record<string, string | null> = {};
    for (const c of CAMPOS_LOJA) {
      const bruto = (valores[c.chave] ?? "").trim();
      payload[c.chave] = bruto === "" ? null : bruto;
    }
    const { error } = await supabase.rpc("guardar_indicadores_loja", {
      p_loja_id: loja.id,
      p_valores: payload,
      p_nota: nota.trim() === "" ? null : nota.trim(),
    });
    setAGravar(false);
    if (error) {
      onErro(mensagemDeErro(error, PATCH, "Não foi possível guardar os valores da loja."));
      return;
    }
    onFeito(`Valores da ${loja.codigo} guardados.`);
    router.refresh();
  }

  async function repor() {
    setAGravar(true);
    onErro("");
    const supabase = createClientBrowser();
    const { error } = await supabase.rpc("limpar_indicadores_loja", { p_loja_id: loja.id });
    setAGravar(false);
    if (error) {
      onErro(mensagemDeErro(error, PATCH, "Não foi possível repor a loja no automático."));
      return;
    }
    setValores({ caixa: "", saldo: "", investimento: "", valores_a_pagar: "" });
    setNota("");
    onFeito(`${loja.codigo} voltou ao cálculo automático.`);
    router.refresh();
  }

  return (
    <section className="rounded-xl border border-[#C9A962]/30 bg-[#141414] p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-medium text-[#F5F5F5]">
            <Store className="h-4 w-4 text-[#C9A962]" />
            {loja.nome}
            <span className="font-mono text-[11px] text-[#525252]">{loja.codigo}</span>
          </h2>
          <p className="mt-1 text-xs text-[#8A8A8A]">
            {loja.provincia ?? "—"} · gerente: {loja.manager ?? "por atribuir"} ·{" "}
            {loja.vendas_count} venda(s) · stock {formatCurrency(loja.stock_valor)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-wider ${
              loja.pode_editar
                ? "border-[#5FBF8F]/40 text-[#5FBF8F]"
                : "border-[#404040] text-[#8A8A8A]"
            }`}
          >
            {loja.pode_editar ? "Pode corrigir" : "Só leitura"}
          </span>
          <button
            type="button"
            onClick={onFechar}
            className="rounded-lg border border-[#333] p-1.5 text-[#8A8A8A] hover:border-[#C9A962]/50 hover:text-[#C9A962]"
            aria-label="Fechar"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {!loja.pode_editar && (
        <p className="mb-5 rounded-lg border border-[#262626] bg-[#1A1A1A] p-3 text-xs text-[#8A8A8A]">
          {nacional
            ? "A administração nacional corrige apenas as lojas da sua zona. As outras calculam automaticamente."
            : "Só o gerente desta loja pode corrigir os valores dela."}
        </p>
      )}

      <div className="mb-6 grid gap-3 md:grid-cols-2">
        {CAMPOS_LOJA.map((c) => {
          const ind = loja[c.chave];
          const escrito = (valores[c.chave] ?? "").trim() !== "";
          return (
            <div key={c.chave} className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wider text-[#8A8A8A]">{c.rotulo}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-[#6F6F6F]">{c.descricao}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wider ${
                    escrito
                      ? "bg-[#C9A962]/15 text-[#C9A962]"
                      : ind.manual !== null
                        ? "bg-[#C9A962]/10 text-[#C9A962]"
                        : "bg-[#262626] text-[#8A8A8A]"
                  }`}
                >
                  {escrito || ind.manual !== null ? "Manual" : "Automático"}
                </span>
              </div>

              <input
                aria-label={c.rotulo}
                value={valores[c.chave] ?? ""}
                onChange={(e) => definir(c.chave, e.target.value)}
                inputMode="decimal"
                disabled={!loja.pode_editar}
                placeholder={`Automático: ${ind.automatico}`}
                className={`${ENTRADA} mt-3`}
              />

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-[#525252]">
                  {c.notaAuto}: <span className="text-[#A3A3A3]">{formatCurrency(ind.automatico)}</span>
                  {ind.manual !== null && (
                    <>
                      {" · escrito: "}
                      <span className="text-[#C9A962]">{formatCurrency(ind.manual)}</span>
                    </>
                  )}
                </p>
                {loja.pode_editar && (
                  <div className="flex gap-2">
                    {escrito && (
                      <button
                        type="button"
                        onClick={() => usarAutomatico(c.chave)}
                        className="text-[11px] text-[#8A8A8A] underline-offset-2 hover:text-[#C9A962] hover:underline"
                      >
                        Automático
                      </button>
                    )}
                    {!escrito && (
                      <button
                        type="button"
                        onClick={() => copiarAutomatico(c.chave)}
                        className="text-[11px] text-[#8A8A8A] underline-offset-2 hover:text-[#C9A962] hover:underline"
                      >
                        Copiar automático
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {loja.pode_editar && (
        <div className="mb-6">
          <label className={ROTULO} htmlFor={`loja-nota-${loja.id}`}>
            Nota desta alteração (opcional)
          </label>
          <input
            id={`loja-nota-${loja.id}`}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Ex.: contagem de caixa à sexta-feira"
            className={ENTRADA}
          />
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={guardar}
              disabled={aGravar || !porGuardar}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#C9A962] px-4 py-2 text-sm font-medium text-[#0A0A0A] transition hover:bg-[#D9BC7A] disabled:opacity-40"
            >
              <Check className="h-3.5 w-3.5" />
              {aGravar ? "A guardar…" : "Guardar valores"}
            </button>
            <button
              type="button"
              onClick={repor}
              disabled={aGravar}
              className="rounded-lg border border-[#333] px-4 py-2 text-sm text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962] disabled:opacity-40"
            >
              Repor no automático
            </button>
          </div>
        </div>
      )}

      <div className="border-t border-[#1F1F1F] pt-5">
        {!aEditarDados ? (
          <button
            type="button"
            onClick={() => setAEditarDados(true)}
            className="text-xs text-[#8A8A8A] underline-offset-2 hover:text-[#C9A962] hover:underline"
          >
            Editar dados da loja (código, nome, província, gerente)
          </button>
        ) : (
          <DadosLoja
            loja={loja}
            provincias={provincias}
            gerentes={gerentes}
            nacional={nacional}
            provinciaFixa={provinciaFixa}
            onFechar={() => setAEditarDados(false)}
            onFeito={(msg) => {
              setAEditarDados(false);
              onFeito(msg);
            }}
            onErro={onErro}
          />
        )}
        <p className="mt-3 text-[10px] text-[#525252]">
          Última correcção: {quandoLoja(loja.updated_at)}
        </p>
      </div>
    </section>
  );
}

/** Criar ou editar os dados da loja (incluindo o gerente). */
function DadosLoja({
  loja,
  provincias,
  gerentes,
  nacional,
  provinciaFixa,
  onFechar,
  onFeito,
  onErro,
}: {
  loja: LinhaLoja | null;
  provincias: ProvinciaOpcao[];
  gerentes: GerenteOpcao[];
  nacional: boolean;
  provinciaFixa: string | null;
  onFechar: () => void;
  onFeito: (msg: string) => void;
  onErro: (msg: string) => void;
}) {
  const router = useRouter();
  const [codigo, setCodigo] = useState(loja?.codigo ?? "");
  const [nome, setNome] = useState(loja?.nome ?? "");
  const [provinciaId, setProvinciaId] = useState(
    loja?.provincia_id ?? provinciaFixa ?? provincias[0]?.id ?? ""
  );
  const [managerId, setManagerId] = useState(loja?.manager_id ?? "");
  const [telefone, setTelefone] = useState("");
  const [endereco, setEndereco] = useState("");
  const [nota, setNota] = useState("");
  const [ativo, setAtivo] = useState(loja?.is_active ?? true);
  const [aGravar, setAGravar] = useState(false);

  const gerentesDaProvincia = useMemo(
    () =>
      gerentes.filter(
        (g) => g.provincia_id === provinciaId || g.is_national_admin
      ),
    [gerentes, provinciaId]
  );

  async function guardar() {
    setAGravar(true);
    onErro("");
    const supabase = createClientBrowser();
    const { error } = await supabase.rpc("guardar_loja", {
      p_codigo: codigo,
      p_nome: nome,
      p_provincia_id: provinciaId,
      p_manager_id: managerId === "" ? null : managerId,
      p_telefone: telefone.trim() === "" ? null : telefone.trim(),
      p_endereco: endereco.trim() === "" ? null : endereco.trim(),
      p_nota: nota.trim() === "" ? null : nota.trim(),
      p_is_active: ativo,
      p_id: loja?.id ?? null,
    });
    setAGravar(false);
    if (error) {
      onErro(mensagemDeErro(error, PATCH, "Não foi possível guardar a loja."));
      return;
    }
    onFeito(loja ? `Loja ${codigo} actualizada.` : `Loja ${codigo} criada.`);
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-[#F5F5F5]">
          {loja ? `Dados da ${loja.codigo}` : "Nova loja"}
        </h3>
        <button
          type="button"
          onClick={onFechar}
          className="rounded-lg border border-[#333] p-1.5 text-[#8A8A8A] hover:border-[#C9A962]/50 hover:text-[#C9A962]"
          aria-label="Fechar"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={ROTULO} htmlFor="loja-codigo">
            Código
          </label>
          <input
            id="loja-codigo"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            placeholder="Ex.: UIG-02"
            className={`${ENTRADA} font-mono`}
          />
        </div>
        <div>
          <label className={ROTULO} htmlFor="loja-nome">
            Nome
          </label>
          <input
            id="loja-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: Loja do Centro"
            className={ENTRADA}
          />
        </div>
        <div>
          <label className={ROTULO} htmlFor="loja-provincia">
            Província
          </label>
          <select
            id="loja-provincia"
            value={provinciaId}
            onChange={(e) => {
              setProvinciaId(e.target.value);
              setManagerId("");
            }}
            disabled={!nacional || provinciaFixa !== null}
            className={ENTRADA}
          >
            {provincias.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
                {p.is_default ? " (sede)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={ROTULO} htmlFor="loja-gerente">
            Gerente da loja
          </label>
          <select
            id="loja-gerente"
            value={managerId}
            onChange={(e) => setManagerId(e.target.value)}
            className={ENTRADA}
          >
            <option value="">Por atribuir</option>
            {gerentesDaProvincia.map((g) => (
              <option key={g.id} value={g.id}>
                {g.full_name}
                {g.is_national_admin ? " (nacional)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={ROTULO} htmlFor="loja-telefone">
            Telefone
          </label>
          <input
            id="loja-telefone"
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            placeholder="+244 9xx xxx xxx"
            className={ENTRADA}
          />
        </div>
        <div>
          <label className={ROTULO} htmlFor="loja-endereco">
            Endereço
          </label>
          <input
            id="loja-endereco"
            value={endereco}
            onChange={(e) => setEndereco(e.target.value)}
            placeholder="Rua, bairro, município"
            className={ENTRADA}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={ROTULO} htmlFor="loja-nota-dados">
            Nota
          </label>
          <input
            id="loja-nota-dados"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Observações internas"
            className={ENTRADA}
          />
        </div>
      </div>

      <label className="mt-4 flex items-center gap-2 text-xs text-[#A3A3A3]">
        <input
          type="checkbox"
          checked={ativo}
          onChange={(e) => setAtivo(e.target.checked)}
          className="h-3.5 w-3.5 accent-[#C9A962]"
        />
        Loja activa
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={guardar}
          disabled={aGravar || codigo.trim() === "" || nome.trim() === ""}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#C9A962] px-4 py-2 text-sm font-medium text-[#0A0A0A] transition hover:bg-[#D9BC7A] disabled:opacity-40"
        >
          <Check className="h-3.5 w-3.5" />
          {aGravar ? "A guardar…" : loja ? "Guardar dados" : "Criar loja"}
        </button>
        <button
          type="button"
          onClick={onFechar}
          className="rounded-lg border border-[#333] px-4 py-2 text-sm text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
