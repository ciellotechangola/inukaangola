"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { formatCurrency } from "@/lib/utils";
import { mensagemDeErro } from "@/lib/erros";
import {
  ambitoCatalogo,
  ambitoGeografico,
  deInputData,
  estadoPromocao,
  etiquetaValor,
  normalizarPromocoes,
  paraInputData,
  ROTULO_ESTADO,
  type Promocao,
  type TipoPromocao,
} from "@/lib/promocoes";

const ENTRADA =
  "w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none";
const ROTULO = "mb-1 block text-[10px] uppercase tracking-wider text-[#8A8A8A]";

interface Provincia {
  id: string;
  nome: string;
}
interface Produto {
  id: string;
  name: string;
  sku: string | null;
}

interface Formulario {
  id: string | null;
  nome: string;
  descricao: string;
  tipo: TipoPromocao;
  valor: string;
  inicio: string;
  fim: string;
  provincias: string[];
  produtos: string[];
  ativo: boolean;
}

const VAZIO: Formulario = {
  id: null,
  nome: "",
  descricao: "",
  tipo: "percentagem",
  valor: "",
  inicio: "",
  fim: "",
  provincias: [],
  produtos: [],
  ativo: true,
};

/** Cor do selo por estado da campanha. */
const COR_ESTADO: Record<string, string> = {
  activa: "border-[#1F4D2E] bg-[#0E2417] text-[#22C55E]",
  agendada: "border-[#4A3F1F] bg-[#241E0E] text-[#C9A962]",
  terminada: "border-[#333333] bg-[#151515] text-[#8A8A8A]",
  desligada: "border-[#4A2020] bg-[#2A1010] text-[#F87171]",
};

export default function GestaoPromocoes() {
  const [promocoes, setPromocoes] = useState<Promocao[]>([]);
  const [provincias, setProvincias] = useState<Provincia[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [form, setForm] = useState<Formulario | null>(null);
  const [buscaProduto, setBuscaProduto] = useState("");
  const [aGravar, setAGravar] = useState(false);

  const carregar = useCallback(async () => {
    const supabase = createClientBrowser();
    const [{ data: lista, error: erroLista }, { data: provs }, { data: prods }] = await Promise.all([
      supabase.rpc("promocoes_lista"),
      supabase.from("provincias").select("id, nome").order("nome"),
      supabase.from("products").select("id, name, sku").eq("is_active", true).order("name"),
    ]);

    if (erroLista) setErro(mensagemDeErro(erroLista));
    else setErro("");

    setPromocoes(normalizarPromocoes(lista));
    setProvincias((provs ?? []) as Provincia[]);
    setProdutos((prods ?? []) as Produto[]);
    setCarregando(false);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const produtosFiltrados = useMemo(() => {
    const termo = buscaProduto.trim().toLowerCase();
    if (!termo) return produtos.slice(0, 60);
    return produtos
      .filter(
        (p) =>
          p.name.toLowerCase().includes(termo) || (p.sku ?? "").toLowerCase().includes(termo)
      )
      .slice(0, 60);
  }, [produtos, buscaProduto]);

  function abrirNova() {
    setAviso("");
    setErro("");
    setBuscaProduto("");
    setForm({ ...VAZIO, inicio: paraInputData(new Date().toISOString()) });
  }

  function abrirEdicao(p: Promocao) {
    setAviso("");
    setErro("");
    setBuscaProduto("");
    setForm({
      id: p.id,
      nome: p.nome,
      descricao: p.descricao ?? "",
      tipo: p.tipo,
      valor: String(p.valor),
      inicio: paraInputData(p.starts_at),
      fim: paraInputData(p.ends_at),
      provincias: p.provincia_ids,
      produtos: p.product_ids,
      ativo: p.ativo,
    });
  }

  function alternar(lista: string[], id: string): string[] {
    return lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id];
  }

  async function gravar() {
    if (!form) return;
    setErro("");
    setAviso("");

    const valor = Number(String(form.valor).replace(",", "."));
    if (!form.nome.trim()) {
      setErro("Indique o nome da promoção.");
      return;
    }
    if (!Number.isFinite(valor) || valor <= 0) {
      setErro("Indique o valor da promoção.");
      return;
    }
    if (form.tipo === "percentagem" && valor > 100) {
      setErro("O desconto não pode passar dos 100 %.");
      return;
    }

    setAGravar(true);
    const supabase = createClientBrowser();
    const inicio = deInputData(form.inicio) ?? new Date().toISOString();
    const fim = deInputData(form.fim);

    const args = {
      p_nome: form.nome.trim(),
      p_tipo: form.tipo,
      p_valor: valor,
      p_starts_at: inicio,
      p_ends_at: fim,
      p_provincias: form.provincias,
      p_produtos: form.produtos,
      p_descricao: form.descricao.trim() || null,
      p_ativo: form.ativo,
    };

    const { error } = form.id
      ? await supabase.rpc("actualizar_promocao", {
          p_id: form.id,
          ...args,
          // `p_ends_at: null` significa «não mexer». Para apagar mesmo a data
          // de fim é preciso pedi-lo explicitamente.
          p_limpar_fim: fim === null,
        })
      : await supabase.rpc("criar_promocao", args);

    setAGravar(false);

    if (error) {
      setErro(mensagemDeErro(error));
      return;
    }

    setAviso(form.id ? "Promoção actualizada." : "Promoção criada.");
    setForm(null);
    await carregar();
  }

  async function eliminar(p: Promocao) {
    if (!window.confirm(`Eliminar a promoção «${p.nome}»? Os preços voltam ao valor base.`)) return;
    setErro("");
    const supabase = createClientBrowser();
    const { error } = await supabase.rpc("eliminar_promocao", { p_id: p.id });
    if (error) {
      setErro(mensagemDeErro(error));
      return;
    }
    setAviso("Promoção eliminada.");
    await carregar();
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-light text-[#F5F5F5]">Promoções</h1>
          <p className="mt-1 text-sm text-[#A3A3A3]">
            Campanhas por província, com período e produtos. O preço aplicado é o que o cliente
            paga — a mesma regra que a encomenda usa.
          </p>
        </div>
        {!form && (
          <button
            onClick={abrirNova}
            className="rounded-lg bg-[#C9A962] px-4 py-2 text-sm font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7]"
          >
            Nova promoção
          </button>
        )}
      </div>

      {erro && (
        <div className="mb-4 rounded-lg border border-[#4A2020] bg-[#2A1010] p-3 text-sm text-[#F87171]">
          {erro}
        </div>
      )}
      {aviso && (
        <div className="mb-4 rounded-lg border border-[#1F4D2E] bg-[#0E2417] p-3 text-sm text-[#22C55E]">
          {aviso}
        </div>
      )}

      {form && (
        <div className="mb-8 rounded-xl border border-[#262626] bg-[#121212] p-5">
          <h2 className="mb-4 text-sm uppercase tracking-wider text-[#C9A962]">
            {form.id ? "Editar promoção" : "Nova promoção"}
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={ROTULO} htmlFor="nome">Nome</label>
              <input
                id="nome"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="Ex.: Black Friday Uíge"
                className={ENTRADA}
              />
            </div>

            <div>
              <label className={ROTULO} htmlFor="tipo">Tipo de desconto</label>
              <select
                id="tipo"
                value={form.tipo}
                onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoPromocao })}
                className={ENTRADA}
              >
                <option value="percentagem">Percentagem (%)</option>
                <option value="preco">Preço fixo (Kz)</option>
              </select>
            </div>

            <div>
              <label className={ROTULO} htmlFor="valor">
                {form.tipo === "percentagem" ? "Desconto (%)" : "Preço final (Kz)"}
              </label>
              <input
                id="valor"
                value={form.valor}
                onChange={(e) => setForm({ ...form, valor: e.target.value })}
                inputMode="decimal"
                placeholder={form.tipo === "percentagem" ? "20" : "12000"}
                className={ENTRADA}
              />
            </div>

            <div>
              <label className={ROTULO} htmlFor="inicio">Começa em</label>
              <input
                id="inicio"
                type="datetime-local"
                value={form.inicio}
                onChange={(e) => setForm({ ...form, inicio: e.target.value })}
                className={ENTRADA}
              />
            </div>

            <div>
              <label className={ROTULO} htmlFor="fim">Termina em (opcional)</label>
              <input
                id="fim"
                type="datetime-local"
                value={form.fim}
                onChange={(e) => setForm({ ...form, fim: e.target.value })}
                className={ENTRADA}
              />
            </div>

            <div className="sm:col-span-2">
              <label className={ROTULO} htmlFor="descricao">Descrição (opcional)</label>
              <input
                id="descricao"
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                placeholder="Uma linha que o cliente lê na montra"
                className={ENTRADA}
              />
            </div>
          </div>

          {/* Províncias */}
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <span className={ROTULO + " mb-0"}>Províncias</span>
              <button
                type="button"
                onClick={() =>
                  setForm({
                    ...form,
                    provincias:
                      form.provincias.length === provincias.length
                        ? []
                        : provincias.map((p) => p.id),
                  })
                }
                className="text-[11px] text-[#C9A962] hover:underline"
              >
                {form.provincias.length === provincias.length ? "Limpar" : "Todas"}
              </button>
            </div>
            <p className="mb-2 text-[11px] text-[#525252]">
              Nenhuma assinalada = a promoção vale no país inteiro.
            </p>
            <div className="grid max-h-56 grid-cols-2 gap-1.5 overflow-y-auto rounded-lg border border-[#262626] p-2 sm:grid-cols-3">
              {provincias.map((p) => (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-[#D4D4D4] hover:bg-[#1A1A1A]"
                >
                  <input
                    type="checkbox"
                    checked={form.provincias.includes(p.id)}
                    onChange={() => setForm({ ...form, provincias: alternar(form.provincias, p.id) })}
                    className="accent-[#C9A962]"
                  />
                  {p.nome}
                </label>
              ))}
            </div>
          </div>

          {/* Produtos */}
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <span className={ROTULO + " mb-0"}>Produtos</span>
              <span className="text-[11px] text-[#8A8A8A]">
                {form.produtos.length === 0
                  ? "Todo o catálogo"
                  : `${form.produtos.length} escolhido${form.produtos.length > 1 ? "s" : ""}`}
              </span>
            </div>
            <p className="mb-2 text-[11px] text-[#525252]">
              Nenhum assinalado = a promoção aplica-se a todos os produtos.
            </p>
            <input
              value={buscaProduto}
              onChange={(e) => setBuscaProduto(e.target.value)}
              placeholder="Procurar produto por nome ou SKU…"
              className={ENTRADA + " mb-2"}
            />
            <div className="grid max-h-56 grid-cols-1 gap-1.5 overflow-y-auto rounded-lg border border-[#262626] p-2 sm:grid-cols-2">
              {produtosFiltrados.map((p) => (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-[#D4D4D4] hover:bg-[#1A1A1A]"
                >
                  <input
                    type="checkbox"
                    checked={form.produtos.includes(p.id)}
                    onChange={() => setForm({ ...form, produtos: alternar(form.produtos, p.id) })}
                    className="accent-[#C9A962]"
                  />
                  <span className="truncate">{p.name}</span>
                  {p.sku && <span className="ml-auto shrink-0 text-[10px] text-[#525252]">{p.sku}</span>}
                </label>
              ))}
              {produtosFiltrados.length === 0 && (
                <p className="p-2 text-xs text-[#6F6F6F]">Nenhum produto encontrado.</p>
              )}
            </div>
          </div>

          <label className="mt-4 flex items-center gap-2 text-xs text-[#D4D4D4]">
            <input
              type="checkbox"
              checked={form.ativo}
              onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
              className="accent-[#C9A962]"
            />
            Activa (desmarque para guardar sem publicar)
          </label>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              onClick={gravar}
              disabled={aGravar}
              className="rounded-lg bg-[#C9A962] px-4 py-2 text-sm font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-50"
            >
              {aGravar ? "A gravar…" : form.id ? "Guardar alterações" : "Criar promoção"}
            </button>
            <button
              onClick={() => setForm(null)}
              className="rounded-lg border border-[#404040] px-4 py-2 text-sm text-[#D4D4D4] transition hover:border-[#C9A962]"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {carregando ? (
        <p className="text-sm text-[#8A8A8A]">A carregar promoções…</p>
      ) : promocoes.length === 0 ? (
        <div className="rounded-xl border border-[#262626] bg-[#121212] p-8 text-center">
          <p className="text-sm text-[#A3A3A3]">
            Ainda não há promoções. Sem campanha, o preço é o de sempre: o promocional do produto
            ou, na falta dele, o oficial.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {promocoes.map((p) => {
            const estado = estadoPromocao(p);
            return (
              <div
                key={p.id}
                className="rounded-xl border border-[#262626] bg-[#121212] p-4 transition hover:border-[#333333]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium text-[#F5F5F5]">{p.nome}</h3>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${COR_ESTADO[estado]}`}
                      >
                        {ROTULO_ESTADO[estado]}
                      </span>
                      <span className="rounded-full border border-[#333333] px-2 py-0.5 text-[10px] text-[#C9A962]">
                        {etiquetaValor(p, formatCurrency)}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-[#8A8A8A]">
                      {ambitoGeografico(p)} · {ambitoCatalogo(p)}
                      {p.ends_at
                        ? ` · até ${new Date(p.ends_at).toLocaleDateString("pt-PT")}`
                        : " · sem fim marcado"}
                    </p>
                    {p.descricao && (
                      <p className="mt-1 text-xs text-[#A3A3A3]">{p.descricao}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => abrirEdicao(p)}
                      className="rounded-lg border border-[#404040] px-3 py-1.5 text-[11px] text-[#D4D4D4] transition hover:border-[#C9A962]"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => eliminar(p)}
                      className="rounded-lg border border-[#4A2020] px-3 py-1.5 text-[11px] text-[#F87171] transition hover:bg-[#2A1010]"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
