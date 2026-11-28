"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Lightbulb,
  Minus,
  Package,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import FotoProduto from "@/components/produto/FotoProduto";
import { formatCurrency } from "@/lib/utils";
import type { ProdutoGrosso } from "@/lib/revenda";

interface LinhaCarrinho {
  produto: ProdutoGrosso;
  quantidade: number;
}

/** Onde ficam guardados os preços de venda que o revendedor definiu. */
const CHAVE_PRECOS = "inuka:revenda:precos-venda";

/**
 * CATÁLOGO DE GROSSO — a ferramenta de negócio do revendedor.
 *
 * Não é uma montra: é uma calculadora de margem com um botão de pedido. Cada
 * cartão mostra os dois números que decidem a compra —
 *
 *   · **preço de aquisição** (o que ele paga à INUKA, por unidade);
 *   · **preço mínimo oficial de venda ao cliente final** (a referência da
 *     INUKA, não um tecto).
 *
 * O revendedor escreve o preço a que quer vender e vê o lucro por unidade e no
 * total mudar no mesmo instante. O preço de venda é **dele**: fica só neste
 * dispositivo (`localStorage`), não sobe para a base e não toca no preço do
 * produto nem no do pedido. O pedido continua a ser cotado pelo preço de
 * aquisição — a margem é o negócio dele, não uma condição da INUKA.
 *
 * A regra do pedido é uma só, vinda da base (`minha_revenda().regras`): **N
 * unidades no total** (4, por regra da casa). Cada linha começa em 1 unidade e
 * o revendedor sobe como quiser; 4 do mesmo produto valem tanto como 1+1+1+1
 * de quatro produtos. Quem soma é o carrinho, não a lista de produtos.
 */
export default function CatalogoGrosso({
  produtos,
  minimo,
  revendedor,
  semMigracao,
}: {
  produtos: ProdutoGrosso[];
  /** Unidades mínimas **do pedido inteiro**, não de cada linha. */
  minimo: number;
  revendedor: { id: string; nome: string };
  semMigracao: boolean;
}) {
  const [procura, setProcura] = useState("");
  const [categoria, setCategoria] = useState("");
  const [carrinho, setCarrinho] = useState<Record<string, number>>({});
  /** Preço de venda escolhido pelo revendedor, por produto. */
  const [precos, setPrecos] = useState<Record<string, number>>({});
  const [precosLidos, setPrecosLidos] = useState(false);
  const [avisoFechado, setAvisoFechado] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState("");
  const [confirmado, setConfirmado] = useState<{
    numero: string;
    total: number;
    lucro: number;
  } | null>(null);

  const chavePrecos = `${CHAVE_PRECOS}:${revendedor.id}`;

  // --- os preços de venda são uma estratégia, não um dado do pedido --------
  // Ficam no dispositivo para o revendedor não os reescrever a cada visita.
  //
  // Isto é uma leitura de um sistema externo (localStorage), e tem de ser
  // depois da montagem: no servidor não existe `window`, e ler no `useState`
  // inicial faria o HTML do servidor discordar do primeiro render do browser
  // (preço oficial de um lado, preço guardado do outro). O aviso do lint é
  // sobre renderizações em cascata; aqui é uma vez, à entrada.
  useEffect(() => {
    let guardado: Record<string, number> = {};
    try {
      const bruto = window.localStorage.getItem(chavePrecos);
      if (bruto) {
        const lido = JSON.parse(bruto) as Record<string, unknown>;
        for (const [id, valor] of Object.entries(lido)) {
          const n = Number(valor);
          if (Number.isFinite(n) && n > 0) guardado[id] = Math.round(n);
        }
      }
    } catch {
      // Sem armazenamento (modo privado, quota cheia): vale o preço oficial.
      guardado = {};
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ler localStorage na montagem, ver acima
    setPrecos(guardado);
    setPrecosLidos(true);
  }, [chavePrecos]);

  useEffect(() => {
    if (!precosLidos) return;
    try {
      window.localStorage.setItem(chavePrecos, JSON.stringify(precos));
    } catch {
      // Guardar é uma comodidade; falhar não pode partir o catálogo.
    }
  }, [precos, precosLidos, chavePrecos]);

  const categorias = useMemo(
    () => [...new Set(produtos.map((p) => p.categoria).filter(Boolean) as string[])].sort(),
    [produtos]
  );

  const filtrados = useMemo(() => {
    const termo = procura.trim().toLowerCase();
    return produtos.filter((p) => {
      const casaTexto =
        termo === "" ||
        p.nome.toLowerCase().includes(termo) ||
        (p.sku ?? "").toLowerCase().includes(termo);
      const casaCategoria = categoria === "" || p.categoria === categoria;
      return casaTexto && casaCategoria;
    });
  }, [produtos, procura, categoria]);

  const linhas: LinhaCarrinho[] = useMemo(
    () =>
      Object.entries(carrinho)
        .map(([id, quantidade]) => {
          const produto = produtos.find((p) => p.product_id === id);
          return produto ? { produto, quantidade } : null;
        })
        .filter((l): l is LinhaCarrinho => l !== null),
    [carrinho, produtos]
  );

  /** Preço a que o revendedor vende. Sem escolha própria, o mínimo oficial. */
  function precoVenda(p: ProdutoGrosso): number {
    const escolhido = precos[p.product_id];
    return escolhido && escolhido > 0 ? escolhido : p.preco_loja;
  }

  function lucroUnidade(p: ProdutoGrosso): number {
    return precoVenda(p) - p.preco_grosso;
  }

  const totalUnidades = linhas.reduce((soma, l) => soma + l.quantidade, 0);
  const investimento = linhas.reduce(
    (soma, l) => soma + l.produto.preco_grosso * l.quantidade,
    0
  );
  const receita = linhas.reduce(
    (soma, l) => soma + precoVenda(l.produto) * l.quantidade,
    0
  );
  const lucroTotal = receita - investimento;
  /** Margem sobre o que se investe — a régua de quem compra por grosso. */
  const margemPct = investimento > 0 ? (lucroTotal / investimento) * 100 : 0;

  /** Quantas unidades faltam para o pedido poder seguir. */
  const faltam = Math.max(0, minimo - totalUnidades);
  const podeEnviar = linhas.length > 0 && faltam === 0;

  function quantidadeDe(p: ProdutoGrosso): number {
    return carrinho[p.product_id] ?? 0;
  }

  /** Entra com **1 unidade** — o revendedor sobe a partir daí, se quiser. */
  function adicionar(p: ProdutoGrosso) {
    setErro("");
    setCarrinho((c) => ({ ...c, [p.product_id]: c[p.product_id] ?? 1 }));
  }

  function mudar(p: ProdutoGrosso, delta: number) {
    setCarrinho((c) => {
      const atual = c[p.product_id] ?? 1;
      const novo = Math.max(1, atual + delta);
      return { ...c, [p.product_id]: novo };
    });
  }

  function definirQuantidade(p: ProdutoGrosso, valor: string) {
    const n = Number(valor.replace(/[^0-9]/g, ""));
    if (!Number.isFinite(n)) return;
    setCarrinho((c) => ({ ...c, [p.product_id]: Math.max(1, Math.round(n)) }));
  }

  function remover(id: string) {
    setCarrinho((c) => {
      const copia = { ...c };
      delete copia[id];
      return copia;
    });
  }

  /** Enquanto se escreve não se trava nada: só ao sair é que se corrige. */
  function escreverPreco(p: ProdutoGrosso, valor: string) {
    const n = Number(valor.replace(/[^0-9]/g, ""));
    if (!Number.isFinite(n)) return;
    setPrecos((m) => ({ ...m, [p.product_id]: Math.round(n) }));
  }

  /** O mínimo oficial é o chão: abaixo dele a venda é a perder dinheiro. */
  function confirmarPreco(p: ProdutoGrosso) {
    setPrecos((m) => {
      const atual = m[p.product_id] ?? p.preco_loja;
      const chao = Math.max(0, p.preco_loja);
      return { ...m, [p.product_id]: Math.max(chao, Math.round(atual || chao)) };
    });
  }

  async function enviarPedido() {
    setErro("");
    if (linhas.length === 0) {
      setErro("Adicione pelo menos um produto ao pedido.");
      return;
    }
    if (totalUnidades < minimo) {
      setErro(
        `Selecione pelo menos ${minimo} unidades para poder finalizar a compra. Tem ${totalUnidades}.`
      );
      return;
    }

    setAEnviar(true);
    try {
      const supabase = createClientBrowser();
      const itens = linhas.map((l) => ({
        product_id: l.produto.product_id,
        quantidade: l.quantidade,
      }));

      const { data, error } = await supabase.rpc("registar_pedido_revendedor", {
        p_itens: itens,
        p_mensagem: mensagem.trim() || null,
      });

      if (error) throw new Error(error.message);

      const r = data as { numero?: string; valor_estimado?: number } | null;
      setConfirmado({
        numero: r?.numero ?? "",
        total: Number(r?.valor_estimado ?? investimento),
        lucro: lucroTotal,
      });
      setCarrinho({});
      setMensagem("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível enviar o pedido.");
    } finally {
      setAEnviar(false);
    }
  }

  if (confirmado) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-[#1F3D2B] bg-[#0F1F16] p-8 text-center">
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-[#C9A962]/15 text-[#C9A962]">
          <Check className="h-6 w-6" />
        </span>
        <h2 className="text-lg font-medium text-[#F5F5F5]">Pedido enviado</h2>
        <p className="mt-2 text-sm leading-relaxed text-[#A3A3A3]">
          Pedido <span className="font-mono text-[#C9A962]">{confirmado.numero}</span> registado
          por {formatCurrency(confirmado.total)}. A gestão da sua província vai analisar e
          responder com a cotação.
        </p>
        {confirmado.lucro > 0 && (
          <p className="mt-3 rounded-lg border border-[#2F6B45] bg-[#0F2A18] px-3 py-2 text-xs leading-relaxed text-[#4ADE80]">
            Ao preço de venda que definiu, este pedido pode render{" "}
            <strong className="font-semibold">{formatCurrency(confirmado.lucro)}</strong> de lucro.
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link
            href="/revenda/pedidos"
            className="inline-flex items-center gap-2 rounded-lg bg-[#C9A962] px-4 py-2 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A]"
          >
            Ver os meus pedidos
            <ArrowRight className="h-4 w-4" />
          </Link>
          <button
            type="button"
            onClick={() => setConfirmado(null)}
            className="rounded-lg border border-[#333] px-4 py-2 text-sm text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
          >
            Continuar a comprar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-40">
      <header className="mb-6">
        <Link href="/revenda" className="text-xs text-[#6F6F6F] hover:text-[#C9A962]">
          ← Área de revenda
        </Link>
        <h1 className="mt-2 text-3xl font-light text-[#F5F5F5]">Catálogo de grosso</h1>
        <p className="mt-1 max-w-2xl text-sm text-[#A3A3A3]">
          Preços de revenda oficiais INUKA 2026 para{" "}
          <strong className="font-medium text-[#E5E5E5]">{revendedor.nome}</strong>. Escolha os
          produtos à vontade, a partir de 1 unidade de cada. O pedido segue com{" "}
          <strong className="font-medium text-[#E5E5E5]">{minimo} unidades no total</strong> —
          do mesmo produto ou de produtos diferentes, como preferir.
        </p>

        {/* A indicação visual que enquadra todos os preços do ecrã. */}
        <div className="mt-3 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-[#C9A962]/30 bg-[#C9A962]/5 px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#C9A962]">
            Preço mínimo oficial
          </span>
          <span className="text-[10px] uppercase tracking-[0.14em] text-[#8A8A8A]">
            — o seu preço de venda pode ser superior.
          </span>
        </div>
      </header>

      {semMigracao && (
        <div className="mb-6 rounded-xl border border-[#C9A962]/40 bg-[#C9A962]/10 p-4 text-sm text-[#E3D5A7]">
          Falta aplicar a migração 0026 (`PATCH_REVENDEDORES.sql`) nesta base.
        </div>
      )}

      {/* ------------------------------------------------------------ FILTROS */}
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <label className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#525252]" />
          <input
            value={procura}
            onChange={(e) => setProcura(e.target.value)}
            placeholder="Procurar produto ou SKU"
            className="w-full rounded-lg border border-[#333] bg-[#0A0A0A] py-2 pl-9 pr-3 text-sm text-[#F5F5F5] placeholder:text-[#4A4A4A] focus:border-[#C9A962] focus:outline-none"
          />
        </label>

        <select
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          className="w-full rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none sm:w-auto"
        >
          <option value="">Todas as categorias</option>
          {categorias.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {erro && (
        <p className="mb-5 rounded-lg border border-[#4A2020] bg-[#2A1010] p-3 text-sm text-[#F87171]">
          {erro}
        </p>
      )}

      {/* ------------------------------------------------- MENSAGEM MOTIVADORA */}
      {linhas.length > 0 && !avisoFechado && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#C9A962]/40 bg-gradient-to-r from-[#1A1710] to-[#141414] p-4">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#C9A962]/15 text-[#C9A962]">
            <Lightbulb className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] leading-relaxed text-[#E5E5E5]">
              <strong className="font-semibold text-[#C9A962]">Boa escolha!</strong> Sabia que
              pode aumentar o seu lucro? O preço apresentado é o preço mínimo oficial recomendado
              pela INUKA. Tem liberdade para definir um preço de venda superior, de acordo com a
              sua estratégia comercial. Quanto maior for a sua margem de venda, maior poderá ser
              o seu lucro!
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAvisoFechado(true)}
            aria-label="Fechar aviso"
            className="shrink-0 rounded p-1 text-[#6F6F6F] transition hover:text-[#F5F5F5]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------ PRODUTOS */}
      {filtrados.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#2A2A2A] bg-[#111] px-6 py-16 text-center">
          <Package className="mx-auto mb-3 h-6 w-6 text-[#3A3A3A]" />
          <p className="text-sm text-[#A3A3A3]">
            {produtos.length === 0
              ? "A gestão ainda não inscreveu produtos no catálogo de grosso."
              : "Nenhum produto corresponde à procura."}
          </p>
          {produtos.length === 0 && (
            <p className="mx-auto mt-1 max-w-sm text-xs text-[#5F5F5F]">
              O catálogo de grosso é escolhido pela administração — não é o mesmo da loja. Quando
              houver produtos inscritos, eles aparecem aqui.
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtrados.map((p) => {
            const qtd = quantidadeDe(p);
            const noCarrinho = qtd > 0;
            const semStock = p.stock !== null && p.stock <= 0;
            const venda = precoVenda(p);
            const lucro = lucroUnidade(p);
            const abaixoDoMinimo = venda < p.preco_loja;

            return (
              <article
                key={p.product_id}
                className={`flex min-w-0 flex-col rounded-2xl border p-5 transition sm:p-6 ${
                  noCarrinho
                    ? "border-[#C9A962]/70 bg-[#17150F] shadow-[0_0_30px_-12px_rgba(201,169,98,0.65)]"
                    : "border-[#2A2A2A] bg-[#161616] hover:border-[#3D3D3D]"
                }`}
              >
                {/* ---- cabeçalho: nome, referência e a fotografia discreta ---- */}
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-lg font-bold leading-snug text-[#F5F5F5] sm:text-xl">
                      {p.nome}
                    </h3>
                    <p className="mt-2.5 truncate text-[13px] text-[#8A8A8A]">
                      {p.sku ?? "sem SKU"}
                      {p.categoria ? ` · ${p.categoria}` : ""}
                    </p>
                    <p
                      className={`mt-1 text-[11px] ${
                        semStock ? "text-[#F87171]" : "text-[#5F5F5F]"
                      }`}
                    >
                      {p.stock === null
                        ? "Stock sob consulta"
                        : semStock
                          ? "Sem stock nesta província"
                          : `${p.stock} un. disponíveis`}
                    </p>
                  </div>
                  <FotoProduto
                    src={p.imagem}
                    alt={p.nome}
                    lado={72}
                    raio="lg"
                    respiro="curto"
                    className="shrink-0"
                    vazio={<Package className="h-5 w-5 text-[#B8B8B8]" />}
                  />
                </div>

                <div className="my-4 h-px bg-[#2A2A2A]" />

                {/* ---- os dois números que decidem a compra ---- */}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9C8A5E]">
                      Aquisição
                    </p>
                    {/* O preço de aquisição é o número que manda: caixa dourada
                        com brilho, e a pastilha «por unidade» por baixo. */}
                    <div className="relative mt-2 inline-block">
                      <span className="inline-block rounded-xl border border-[#C9A962] px-3.5 py-1.5 text-2xl font-bold leading-none text-[#E8C766] shadow-[0_0_26px_-8px_rgba(201,169,98,0.85)] sm:text-3xl">
                        {formatCurrency(p.preco_grosso)}
                      </span>
                      <span className="absolute -bottom-3 left-2 inline-flex items-center gap-1.5 rounded-full bg-[#C9A962] px-2.5 py-1 text-[11px] font-semibold leading-none text-[#141414]">
                        <ShoppingCart className="h-3 w-3" />
                        por unidade
                      </span>
                    </div>
                  </div>

                  <div className="shrink-0 pt-1 text-right">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8A8A8A]">
                      Mín. oficial
                    </p>
                    <p className="mt-2 text-xl font-semibold leading-none text-[#F5F5F5]">
                      {formatCurrency(p.preco_loja)}
                    </p>
                    <p className="mt-1 text-[12px] text-[#8A8A8A]">venda ao cliente</p>
                  </div>
                </div>

                {/* `mt-8` abre espaço para a pastilha que sai da caixa do preço. */}
                <div className="mt-8">
                  {noCarrinho ? (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-stretch overflow-hidden rounded-xl border border-[#3A3A3A]">
                          <button
                            type="button"
                            onClick={() => mudar(p, -1)}
                            disabled={qtd <= 1}
                            aria-label="Diminuir"
                            className="grid h-11 w-14 place-items-center text-[#A3A3A3] transition hover:text-[#C9A962] disabled:opacity-30 disabled:hover:text-[#A3A3A3]"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <input
                            value={qtd}
                            onChange={(e) => definirQuantidade(p, e.target.value)}
                            inputMode="numeric"
                            aria-label={`Quantidade de ${p.nome}`}
                            className="h-11 w-14 border-x border-[#3A3A3A] bg-transparent text-center text-base text-[#F5F5F5] focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => mudar(p, 1)}
                            aria-label="Aumentar"
                            className="grid h-11 w-14 place-items-center text-[#A3A3A3] transition hover:text-[#C9A962]"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => remover(p.product_id)}
                          className="inline-flex items-center gap-2 text-[13px] text-[#8A8A8A] transition hover:text-[#F87171]"
                        >
                          <Trash2 className="h-4 w-4" />
                          remover
                        </button>
                      </div>

                      {/* O preço é dele: escreve, e o lucro muda à vista. */}
                      <div className="mt-4 rounded-xl border border-[#2E2E2E] bg-[#101010] p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <label
                            htmlFor={`venda-${p.product_id}`}
                            className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9A9A9A]"
                          >
                            O seu preço de venda
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              id={`venda-${p.product_id}`}
                              value={venda}
                              onChange={(e) => escreverPreco(p, e.target.value)}
                              onBlur={() => confirmarPreco(p)}
                              inputMode="numeric"
                              className={`w-32 rounded-lg border bg-transparent px-3 py-2 text-right text-xl font-semibold focus:outline-none sm:w-36 ${
                                abaixoDoMinimo
                                  ? "border-[#7A5A20] text-[#E3D5A7]"
                                  : "border-[#444] text-[#F5F5F5] focus:border-[#C9A962]"
                              }`}
                            />
                            <span className="text-[13px] text-[#8A8A8A]">Kz</span>
                          </div>
                        </div>

                        <div className="my-3.5 h-px bg-[#242424]" />

                        <div className="space-y-2.5">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="inline-flex items-center gap-1.5 text-[13px] text-[#A3A3A3]">
                              <TrendingUp className="h-4 w-4 text-[#6F6F6F]" />
                              Lucro por unidade
                            </span>
                            <span
                              className={`text-xl font-bold ${
                                lucro > 0 ? "text-[#4ADE80]" : "text-[#E3D5A7]"
                              }`}
                            >
                              {formatCurrency(lucro)}
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-[13px] text-[#A3A3A3]">
                              Lucro nas {qtd} un.
                            </span>
                            <span
                              className={`text-lg font-bold ${
                                lucro > 0 ? "text-[#4ADE80]" : "text-[#E3D5A7]"
                              }`}
                            >
                              {formatCurrency(lucro * qtd)}
                            </span>
                          </div>
                        </div>

                        {abaixoDoMinimo && (
                          <p className="mt-2.5 text-[11px] leading-relaxed text-[#E3D5A7]">
                            Abaixo do mínimo oficial ({formatCurrency(p.preco_loja)}). Ao sair do
                            campo volta ao mínimo.
                          </p>
                        )}
                      </div>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => adicionar(p)}
                      disabled={semStock}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#C9A962]/50 bg-[#C9A962]/5 px-4 py-3 text-[13px] font-semibold text-[#C9A962] transition hover:bg-[#C9A962] hover:text-[#0A0A0A] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#C9A962]/5 disabled:hover:text-[#C9A962]"
                    >
                      <Plus className="h-4 w-4" />
                      {semStock ? "Sem stock nesta província" : "Adicionar 1 unidade"}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* ------------------------------------------------- RESUMO DO PEDIDO */}
      {linhas.length > 0 && (
        <section className="mt-8 rounded-2xl border border-[#262626] bg-[#111] p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-sm font-medium text-[#F5F5F5]">Resumo do pedido</h2>
              <p className="mt-1 text-[11.5px] leading-relaxed text-[#6F6F6F]">
                O que paga à INUKA, o que pode receber do cliente e o que fica para si.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#2F6B45] bg-[#0F2A18] px-2.5 py-1 text-[10px] font-medium text-[#4ADE80]">
              <TrendingUp className="h-3 w-3" />
              margem de {margemPct.toFixed(0)}% sobre o investimento
            </span>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[42rem] border-collapse text-left text-[12.5px]">
              <thead>
                <tr className="text-[9.5px] uppercase tracking-wide text-[#525252]">
                  <th className="pb-2 pr-3 font-medium">Produto</th>
                  <th className="pb-2 pr-3 text-right font-medium">Aquisição</th>
                  <th className="pb-2 pr-3 text-right font-medium">Mín. oficial</th>
                  <th className="pb-2 pr-3 text-right font-medium">O seu preço</th>
                  <th className="pb-2 pr-3 text-right font-medium">Lucro/un.</th>
                  <th className="pb-2 pr-3 text-right font-medium">Qtd</th>
                  <th className="pb-2 pr-3 text-right font-medium">Investimento</th>
                  <th className="pb-2 text-right font-medium">Lucro</th>
                </tr>
              </thead>
              <tbody className="text-[#D4D4D4]">
                {linhas.map((l) => {
                  const venda = precoVenda(l.produto);
                  const lucro = lucroUnidade(l.produto);
                  return (
                    <tr key={l.produto.product_id} className="border-t border-[#1F1F1F]">
                      <td className="py-2 pr-3">
                        <span className="line-clamp-1">{l.produto.nome}</span>
                      </td>
                      <td className="py-2 pr-3 text-right text-[#C9A962]">
                        {formatCurrency(l.produto.preco_grosso)}
                      </td>
                      <td className="py-2 pr-3 text-right text-[#8A8A8A]">
                        {formatCurrency(l.produto.preco_loja)}
                      </td>
                      <td className="py-2 pr-3 text-right font-medium text-[#F5F5F5]">
                        {formatCurrency(venda)}
                      </td>
                      <td
                        className={`py-2 pr-3 text-right ${
                          lucro > 0 ? "text-[#4ADE80]" : "text-[#E3D5A7]"
                        }`}
                      >
                        {formatCurrency(lucro)}
                      </td>
                      <td className="py-2 pr-3 text-right">{l.quantidade}</td>
                      <td className="py-2 pr-3 text-right">
                        {formatCurrency(l.produto.preco_grosso * l.quantidade)}
                      </td>
                      <td
                        className={`py-2 text-right font-medium ${
                          lucro > 0 ? "text-[#4ADE80]" : "text-[#E3D5A7]"
                        }`}
                      >
                        {formatCurrency(lucro * l.quantidade)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <CartaoTotal
              rotulo="Investimento total"
              valor={formatCurrency(investimento)}
              nota={`${totalUnidades} ${totalUnidades === 1 ? "unidade" : "unidades"}`}
            />
            <CartaoTotal
              rotulo="Receita total estimada"
              valor={formatCurrency(receita)}
              nota="se vender ao preço definido"
            />
            <CartaoTotal
              rotulo="Lucro total estimado"
              valor={formatCurrency(lucroTotal)}
              nota={`${margemPct.toFixed(0)}% sobre o investimento`}
              destaque
            />
            <CartaoTotal
              rotulo="Mínimo do pedido"
              valor={`${minimo} un.`}
              nota={faltam === 0 ? "atingido" : `faltam ${faltam}`}
            />
          </div>

          <p className="mt-3 text-[10.5px] leading-relaxed text-[#525252]">
            O lucro é uma estimativa sua: a INUKA factura o pedido pelo preço de aquisição. O
            preço de venda que escreveu fica guardado neste dispositivo e não altera o preço do
            produto nem a cotação do pedido.
          </p>
        </section>
      )}

      {/* --------------------------------------------------------- BARRA FIXA */}
      {linhas.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#262626] bg-[#0A0A0A]/95 backdrop-blur">
          <div className="mx-auto max-w-6xl px-4 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-xs text-[#A3A3A3]">
                  <ShoppingCart className="h-3.5 w-3.5 text-[#C9A962]" />
                  {linhas.length} {linhas.length === 1 ? "produto" : "produtos"} ·{" "}
                  <span className={faltam === 0 ? "text-[#4ADE80]" : undefined}>
                    {totalUnidades} {totalUnidades === 1 ? "unidade" : "unidades"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCarrinho({})}
                    className="inline-flex items-center gap-1 text-[10px] text-[#525252] hover:text-[#F87171]"
                  >
                    <Trash2 className="h-3 w-3" />
                    limpar
                  </button>
                </p>

                {/* Progresso até ao mínimo: a barra enche à medida que se
                    juntam unidades e fica verde quando a soma chega a 4. */}
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1 w-32 overflow-hidden rounded-full bg-[#262626]">
                    <div
                      className={`h-full rounded-full transition-all ${
                        faltam === 0 ? "bg-[#4ADE80]" : "bg-[#C9A962]"
                      }`}
                      style={{
                        width: `${Math.min(100, Math.round((totalUnidades / Math.max(1, minimo)) * 100))}%`,
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-[#6F6F6F]">
                    {Math.min(totalUnidades, minimo)}/{minimo}
                  </span>
                </div>

                {faltam > 0 ? (
                  <p className="mt-1 text-[11px] text-[#E3D5A7]">
                    Selecione pelo menos {minimo} unidades para poder finalizar a compra.
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-[#4ADE80]">
                    Mínimo atingido — pode finalizar a compra.
                  </p>
                )}
                <input
                  value={mensagem}
                  onChange={(e) => setMensagem(e.target.value)}
                  placeholder="Nota para a gestão (opcional): prazo, entrega, condições…"
                  maxLength={800}
                  className="mt-1.5 w-full rounded-lg border border-[#333] bg-[#141414] px-3 py-2 text-xs text-[#F5F5F5] placeholder:text-[#4A4A4A] focus:border-[#C9A962] focus:outline-none"
                />
              </div>

              <div className="flex items-end gap-5 text-right">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-[#525252]">
                    Investimento
                  </p>
                  <p className="text-sm font-medium text-[#C9A962]">
                    {formatCurrency(investimento)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-[#525252]">
                    Lucro estimado
                  </p>
                  <p
                    className={`text-sm font-semibold ${
                      lucroTotal > 0 ? "text-[#4ADE80]" : "text-[#E3D5A7]"
                    }`}
                  >
                    {formatCurrency(lucroTotal)}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={enviarPedido}
                disabled={aEnviar || !podeEnviar}
                title={
                  podeEnviar
                    ? undefined
                    : `Selecione pelo menos ${minimo} unidades para poder finalizar a compra.`
                }
                className="inline-flex items-center gap-2 rounded-lg bg-[#C9A962] px-5 py-2.5 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#C9A962]"
              >
                {aEnviar ? "A enviar…" : "Enviar pedido"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Um dos quatro números do resumo. `destaque` pinta o lucro a dourado. */
function CartaoTotal({
  rotulo,
  valor,
  nota,
  destaque,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  destaque?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 ${
        destaque ? "border-[#C9A962]/40 bg-[#171308]" : "border-[#1F1F1F] bg-[#0A0A0A]"
      }`}
    >
      <p className="text-[9.5px] uppercase tracking-wide text-[#525252]">{rotulo}</p>
      <p
        className={`mt-0.5 text-sm font-semibold ${
          destaque ? "text-[#C9A962]" : "text-[#F5F5F5]"
        }`}
      >
        {valor}
      </p>
      {nota && <p className="mt-0.5 text-[10px] text-[#5F5F5F]">{nota}</p>}
    </div>
  );
}
