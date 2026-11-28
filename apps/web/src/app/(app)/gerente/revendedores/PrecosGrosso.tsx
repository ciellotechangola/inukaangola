"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  EyeOff,
  Package,
  Plus,
  RotateCcw,
  Save,
  Search,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import FotoProduto from "@/components/produto/FotoProduto";
import { formatCurrency } from "@/lib/utils";
import type { CatalogoGestao, CatalogoProduto } from "./page";

/**
 * Cadastro do catálogo de grosso.
 *
 * O catálogo da loja e o catálogo do grosso são duas decisões diferentes: um
 * perfume de vitrina não é mercadoria de caixa. Aqui a gestão decide **o que
 * um revendedor pode comprar** — e, se quiser, a que preço.
 *
 * Três estados por produto, e só três:
 *   · fora do catálogo            → o revendedor não o vê;
 *   · no catálogo, sem preço      → pendente: continua invisível ao revendedor
 *     até alguém escrever o preço de revenda (0033);
 *   · no catálogo, com preço      → é esse preço que o revendedor paga, tal e
 *     qual, sem descontos nem tabelas por cima.
 *
 * «Repor» limpa o preço **sem** tirar o produto do catálogo — retirar é outra
 * decisão, e tem o seu próprio botão. Um produto sem preço não é vendido a
 * grosso: fica à espera de decisão, não a um preço inventado.
 */
export default function PrecosGrosso({
  catalogo,
  semCatalogo,
}: {
  catalogo: CatalogoGestao;
  /** A migração 0031 ainda não foi aplicada: só se mostram os preços. */
  semCatalogo: boolean;
}) {
  const router = useRouter();
  const [procura, setProcura] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "dentro" | "fora">("todos");
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      catalogo.produtos.map((p) => [
        p.product_id,
        p.preco_proprio === null ? "" : String(p.preco_proprio),
      ])
    )
  );
  const [aGuardar, setAGuardar] = useState<string | null>(null);
  const [guardado, setGuardado] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [aInscrever, setAInscrever] = useState(false);
  const [minimo, setMinimo] = useState(String(catalogo.minimo_unidades));
  const [aGravarMinimo, setAGravarMinimo] = useState(false);
  const [minimoGravado, setMinimoGravado] = useState(false);

  const filtrados = useMemo(() => {
    const termo = procura.trim().toLowerCase();
    return catalogo.produtos.filter((p) => {
      const casaTexto =
        termo === "" ||
        p.nome.toLowerCase().includes(termo) ||
        (p.sku ?? "").toLowerCase().includes(termo);
      const casaFiltro =
        filtro === "todos" ||
        (filtro === "dentro" && p.no_catalogo) ||
        (filtro === "fora" && !p.no_catalogo);
      return casaTexto && casaFiltro;
    });
  }, [catalogo.produtos, procura, filtro]);

  const foraDoCatalogo = catalogo.produtos.filter((p) => !p.no_catalogo).length;
  /** No catálogo mas sem preço: não chegam ao revendedor. */
  const pendentes = catalogo.produtos.filter(
    (p) => p.no_catalogo && p.preco_proprio === null
  ).length;

  async function alternar(p: CatalogoProduto) {
    setErro("");
    setAGuardar(p.product_id);
    try {
      const supabase = createClientBrowser();
      const { error } = p.no_catalogo
        ? await supabase.rpc("remover_produto_catalogo", { p_produto: p.product_id })
        : await supabase.rpc("adicionar_produto_catalogo", { p_produto: p.product_id });
      if (error) throw new Error(error.message);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível alterar o catálogo.");
    } finally {
      setAGuardar(null);
    }
  }

  async function inscreverTodos() {
    setErro("");
    setAInscrever(true);
    try {
      const supabase = createClientBrowser();
      const { error } = await supabase.rpc("adicionar_todos_catalogo");
      if (error) throw new Error(error.message);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível inscrever os produtos.");
    } finally {
      setAInscrever(false);
    }
  }

  async function guardar(p: CatalogoProduto, limpar: boolean) {
    setErro("");
    setGuardado(null);
    setAGuardar(p.product_id);
    try {
      const supabase = createClientBrowser();

      if (limpar) {
        const { error } = await supabase.rpc("limpar_preco_revenda", { p_produto: p.product_id });
        if (error) throw new Error(error.message);
        setValores((v) => ({ ...v, [p.product_id]: "" }));
      } else {
        const bruto = valores[p.product_id] ?? "";
        const preco = Number(bruto.replace(/[^0-9.,]/g, "").replace(",", "."));
        if (!Number.isFinite(preco) || preco <= 0) {
          setErro("Escreva um preço maior do que zero, ou use «Repor».");
          return;
        }
        const { error } = await supabase.rpc("definir_preco_revenda", {
          p_produto: p.product_id,
          p_preco: preco,
          p_nota: null,
        });
        if (error) throw new Error(error.message);
      }

      setGuardado(p.product_id);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar o preço.");
    } finally {
      setAGuardar(null);
    }
  }

  async function guardarMinimo() {
    setErro("");
    setMinimoGravado(false);
    const n = Number(minimo.replace(/[^0-9]/g, ""));
    if (!Number.isFinite(n) || n < 4) {
      setErro("O mínimo é de 4 unidades no total do pedido, ou mais.");
      return;
    }

    setAGravarMinimo(true);
    try {
      const supabase = createClientBrowser();
      const { error } = await supabase
        .from("platform_settings")
        .upsert(
          { key: "revenda_minimo_unidades", value: { value: Math.round(n) } },
          { onConflict: "key" }
        );
      if (error) throw new Error(error.message);
      setMinimoGravado(true);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar o mínimo.");
    } finally {
      setAGravarMinimo(false);
    }
  }

  return (
    <div>
      {semCatalogo && (
        <div className="mb-5 rounded-xl border border-[#C9A962]/40 bg-[#C9A962]/10 p-4 text-sm text-[#E3D5A7]">
          Falta aplicar a migração 0031 (<code>PATCH_CATALOGO_GROSSO.sql</code>). Até lá os
          produtos activos aparecem todos no grosso e não é possível inscrever nem retirar.
        </div>
      )}

      {erro && (
        <p className="mb-4 rounded-lg border border-[#4A2020] bg-[#2A1010] px-3 py-2 text-xs text-[#F87171]">
          {erro}
        </p>
      )}

      {/* ------------------------------------------------------------- NÚMEROS */}
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Indicador
          rotulo="No catálogo de grosso"
          valor={String(catalogo.totais.no_catalogo)}
          destaque
        />
        <Indicador rotulo="Com preço de revenda" valor={String(catalogo.totais.com_preco)} />
        <Indicador rotulo="Pendentes de preço" valor={String(pendentes)} />
        <Indicador rotulo="Fora do catálogo" valor={String(foraDoCatalogo)} />
      </div>

      {/* -------------------------------------------------------- MÍNIMO PEDIDO */}
      <section className="mb-5 rounded-xl border border-[#262626] bg-[#141414] p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[#F5F5F5]">Mínimo de unidades por pedido</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[#8A8A8A]">
              Quantas unidades, <em>somadas em todo o carrinho</em>, um revendedor tem de juntar
              para o pedido seguir. Cada linha pode levar 1 unidade: 4 do mesmo produto contam
              tanto como 1+1+1+1 de quatro produtos. A regra da casa é 4.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wide text-[#6F6F6F]">
                Unidades
              </span>
              <input
                type="number"
                min={4}
                value={minimo}
                onChange={(e) => {
                  setMinimo(e.target.value);
                  setMinimoGravado(false);
                }}
                className="w-24 rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
              />
            </label>
            <button
              type="button"
              onClick={guardarMinimo}
              disabled={aGravarMinimo}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#C9A962]/50 px-3 py-2 text-xs font-medium text-[#C9A962] transition hover:bg-[#C9A962] hover:text-[#0A0A0A] disabled:opacity-50"
            >
              {minimoGravado ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
              {minimoGravado ? "Guardado" : "Guardar"}
            </button>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- FILTROS */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#525252]" />
          <input
            value={procura}
            onChange={(e) => setProcura(e.target.value)}
            placeholder="Procurar produto ou SKU"
            className="w-full rounded-lg border border-[#333] bg-[#0A0A0A] py-2 pl-9 pr-3 text-xs text-[#F5F5F5] placeholder:text-[#4A4A4A] focus:border-[#C9A962] focus:outline-none"
          />
        </label>

        <div className="flex gap-1.5">
          {(
            [
              { chave: "todos", texto: `Todos (${catalogo.produtos.length})` },
              { chave: "dentro", texto: `No grosso (${catalogo.totais.no_catalogo})` },
              { chave: "fora", texto: `Fora (${foraDoCatalogo})` },
            ] as const
          ).map((f) => (
            <button
              key={f.chave}
              type="button"
              onClick={() => setFiltro(f.chave)}
              className={`rounded-lg border px-2.5 py-2 text-[11px] transition ${
                filtro === f.chave
                  ? "border-[#C9A962]/60 bg-[#C9A962]/10 text-[#E3D5A7]"
                  : "border-[#333] text-[#8A8A8A] hover:border-[#C9A962]/40"
              }`}
            >
              {f.texto}
            </button>
          ))}
        </div>

        {!semCatalogo && foraDoCatalogo > 0 && (
          <button
            type="button"
            onClick={inscreverTodos}
            disabled={aInscrever}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[#C9A962] px-3 py-2 text-xs font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A] disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            {aInscrever ? "A inscrever…" : `Inscrever todos (${foraDoCatalogo})`}
          </button>
        )}
      </div>

      {/* ------------------------------------------------------------- PRODUTOS */}
      {filtrados.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#2A2A2A] bg-[#111] px-6 py-14 text-center">
          <Package className="mx-auto mb-3 h-6 w-6 text-[#3A3A3A]" />
          <p className="text-sm text-[#A3A3A3]">
            {catalogo.produtos.length === 0
              ? "Ainda não há produtos activos."
              : "Nenhum produto corresponde ao filtro."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#262626]">
          {filtrados.map((p) => {
            const ocupado = aGuardar === p.product_id;
            return (
              <div
                key={p.product_id}
                className={`flex flex-wrap items-center gap-3 border-b border-[#1F1F1F] px-4 py-3 last:border-0 ${
                  p.no_catalogo ? "bg-[#141414]" : "bg-[#0F0F0F]"
                }`}
              >
                <FotoProduto
                  src={p.imagem}
                  alt={p.nome}
                  lado={40}
                  raio="md"
                  respiro="nenhum"
                  className="shrink-0"
                  vazio={<Package className="h-4 w-4 text-[#B8B8B8]" />}
                />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-[#F5F5F5]">{p.nome}</p>
                  <p className="mt-0.5 text-[10px] text-[#525252]">
                    {p.sku ?? "sem SKU"}
                    {p.categoria ? ` · ${p.categoria}` : ""}
                    {` · loja ${formatCurrency(p.preco_loja)}`}
                  </p>
                </div>

                {/* Inscrição */}
                <button
                  type="button"
                  onClick={() => alternar(p)}
                  disabled={ocupado || semCatalogo}
                  title={
                    semCatalogo
                      ? "Falta aplicar a migração 0031"
                      : p.no_catalogo
                        ? "Retirar do catálogo de grosso"
                        : "Inscrever no catálogo de grosso"
                  }
                  className={`inline-flex w-32 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition disabled:opacity-50 ${
                    p.no_catalogo
                      ? "border-[#2F6B45] bg-[#0F2A18] text-[#4ADE80]"
                      : "border-[#333] text-[#6F6F6F] hover:border-[#C9A962]/50 hover:text-[#C9A962]"
                  }`}
                >
                  {p.no_catalogo ? (
                    <ToggleRight className="h-3.5 w-3.5" />
                  ) : (
                    <ToggleLeft className="h-3.5 w-3.5" />
                  )}
                  {p.no_catalogo ? "No grosso" : "Fora"}
                </button>

                {/* Preço */}
                <div className="flex shrink-0 items-center gap-1.5">
                  <input
                    value={valores[p.product_id] ?? ""}
                    onChange={(e) =>
                      setValores((v) => ({ ...v, [p.product_id]: e.target.value }))
                    }
                    disabled={!p.no_catalogo}
                    placeholder="preço de revenda"
                    inputMode="decimal"
                    className="w-28 rounded-lg border border-[#404040] bg-[#0A0A0A] px-2.5 py-1.5 text-right text-xs text-[#F5F5F5] placeholder:text-[#4A4A4A] focus:border-[#C9A962] focus:outline-none disabled:opacity-40"
                  />
                  <button
                    type="button"
                    onClick={() => guardar(p, false)}
                    disabled={ocupado || !p.no_catalogo}
                    title="Guardar preço"
                    className="rounded-lg border border-[#333] p-1.5 text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962] disabled:opacity-40"
                  >
                    {guardado === p.product_id ? (
                      <Check className="h-3.5 w-3.5 text-[#4ADE80]" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => guardar(p, true)}
                    disabled={ocupado || !p.no_catalogo || p.preco_proprio === null}
                    title="Limpar o preço de revenda"
                    className="rounded-lg border border-[#333] p-1.5 text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962] disabled:opacity-40"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="w-24 shrink-0 text-right">
                  <p className="text-[10px] uppercase tracking-wide text-[#525252]">Grosso</p>
                  <p
                    className={`text-xs ${
                      !p.no_catalogo
                        ? "text-[#4A4A4A]"
                        : p.preco_grosso === null
                          ? "text-[#E3D5A7]"
                          : "text-[#C9A962]"
                    }`}
                  >
                    {!p.no_catalogo
                      ? "—"
                      : p.preco_grosso === null
                        ? "sem preço"
                        : formatCurrency(p.preco_grosso)}
                  </p>
                </div>

                {p.no_catalogo && p.preco_proprio === null && (
                  <span className="hidden shrink-0 items-center gap-1 text-[10px] text-[#E3D5A7] sm:flex">
                    <EyeOff className="h-3 w-3" />
                    pendente
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-[#525252]">
        O preço que se escreve aqui é o preço de revenda oficial (tabela INUKA 2026) — é o
        que o revendedor paga, sem descontos nem tabelas por cima. Um produto no catálogo
        sem preço fica <strong className="font-medium text-[#8A8A8A]">pendente</strong>: não
        aparece ao revendedor e não entra em pedidos, até alguém decidir o preço.
      </p>
    </div>
  );
}

function Indicador({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: string;
  valor: string;
  destaque?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">{rotulo}</p>
      <p className={`text-lg font-medium ${destaque ? "text-[#E3D5A7]" : "text-[#C9A962]"}`}>
        {valor}
      </p>
    </div>
  );
}
