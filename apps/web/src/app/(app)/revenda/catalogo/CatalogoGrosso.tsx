"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Minus,
  Package,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import ProductImage from "@/components/ProductImage";
import { formatCurrency } from "@/lib/utils";
import type { ProdutoGrosso } from "@/lib/revenda";

interface LinhaCarrinho {
  produto: ProdutoGrosso;
  quantidade: number;
}

/**
 * Catálogo de grosso com carrinho.
 *
 * Duas regras, ambas vindas da base (`minha_revenda().regras`):
 *   · `minimo` unidades por linha — o botão «−» para no mínimo em vez de
 *     deixar chegar a 3 e falhar no servidor;
 *   · `minimoProdutos` produtos **diferentes** por pedido — um pedido de
 *     grosso com uma linha só é uma compra ao balcão com desconto.
 *
 * O preço mostrado é o que a base devolveu. Não há cálculo de desconto no
 * browser: a redução (3.500 / 4.000 / 5.000 Kz) é escolhida na base, produto a
 * produto, e o catálogo só a mostra. O que se calcula aqui é a **conta do
 * lucro** — compra, venda e sobra —, porque é isso que decide um pedido de
 * grosso.
 */
export default function CatalogoGrosso({
  produtos,
  minimo,
  minimoProdutos,
  revendedor,
  semMigracao,
}: {
  produtos: ProdutoGrosso[];
  minimo: number;
  minimoProdutos: number;
  revendedor: string;
  semMigracao: boolean;
}) {
  const [procura, setProcura] = useState("");
  const [categoria, setCategoria] = useState("");
  const [carrinho, setCarrinho] = useState<Record<string, number>>({});
  const [mensagem, setMensagem] = useState("");
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState("");
  const [confirmado, setConfirmado] = useState<{ numero: string; total: number } | null>(null);

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

  const totalUnidades = linhas.reduce((soma, l) => soma + l.quantidade, 0);
  const totalValor = linhas.reduce(
    (soma, l) => soma + l.produto.preco_grosso * l.quantidade,
    0
  );
  /** Quanto o revendedor recebe se vender tudo ao preço de cliente final. */
  const totalVenda = linhas.reduce(
    (soma, l) => soma + l.produto.preco_loja * l.quantidade,
    0
  );
  const totalLucro = totalVenda - totalValor;
  const margemTotal = totalValor > 0 ? (totalLucro / totalValor) * 100 : 0;
  /** Quantos produtos diferentes faltam para o pedido poder seguir. */
  const faltam = Math.max(0, minimoProdutos - linhas.length);

  function quantidadeDe(p: ProdutoGrosso): number {
    return carrinho[p.product_id] ?? 0;
  }

  function adicionar(p: ProdutoGrosso) {
    setErro("");
    setCarrinho((c) => ({ ...c, [p.product_id]: c[p.product_id] ?? p.minimo }));
  }

  function mudar(p: ProdutoGrosso, delta: number) {
    setCarrinho((c) => {
      const atual = c[p.product_id] ?? p.minimo;
      const novo = Math.max(p.minimo, atual + delta);
      return { ...c, [p.product_id]: novo };
    });
  }

  function definir(p: ProdutoGrosso, valor: string) {
    const n = Number(valor.replace(/[^0-9]/g, ""));
    if (!Number.isFinite(n)) return;
    setCarrinho((c) => ({ ...c, [p.product_id]: Math.max(p.minimo, Math.round(n)) }));
  }

  function remover(id: string) {
    setCarrinho((c) => {
      const copia = { ...c };
      delete copia[id];
      return copia;
    });
  }

  async function enviarPedido() {
    setErro("");
    if (linhas.length === 0) {
      setErro("Adicione pelo menos um produto ao pedido.");
      return;
    }
    if (linhas.length < minimoProdutos) {
      setErro(
        `O pedido de grosso exige pelo menos ${minimoProdutos} produtos diferentes. Tem ${linhas.length}.`
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
        total: Number(r?.valor_estimado ?? totalValor),
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
    <div className="pb-32">
      <header className="mb-6">
        <Link href="/revenda" className="text-xs text-[#6F6F6F] hover:text-[#C9A962]">
          ← Área de revenda
        </Link>
        <h1 className="mt-2 text-3xl font-light text-[#F5F5F5]">Catálogo de grosso</h1>
        <p className="mt-1 max-w-2xl text-sm text-[#A3A3A3]">
          Preços de aquisição para{" "}
          <strong className="font-medium text-[#E5E5E5]">{revendedor}</strong>. O preço de
          cliente final fica ao lado do seu, com o lucro por unidade já feito. Mínimo de{" "}
          {minimo} unidades por produto e {minimoProdutos} produtos diferentes por pedido.
        </p>
        <p className="mt-2 max-w-2xl rounded-lg border border-[#262626] bg-[#111] px-3 py-2 text-[11.5px] leading-relaxed text-[#8A8A8A]">
          Preço de cliente final − redução = preço de aquisição. A redução é escolhida pela
          INUKA produto a produto, entre 3.500 e 5.000 Kz, para lhe deixar margem sem tirar
          competitividade à tabela.
        </p>
      </header>

      {semMigracao && (
        <div className="mb-6 rounded-xl border border-[#C9A962]/40 bg-[#C9A962]/10 p-4 text-sm text-[#E3D5A7]">
          Falta aplicar a migração 0026 (`PATCH_REVENDEDORES.sql`) nesta base.
        </div>
      )}

      {/* ------------------------------------------------------------ FILTROS */}
      <div className="mb-5 flex flex-wrap gap-2">
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
          className="rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtrados.map((p) => {
            const qtd = quantidadeDe(p);
            const noCarrinho = qtd > 0;
            const semStock = p.stock !== null && p.stock <= 0;

            return (
              <article
                key={p.product_id}
                className={`flex flex-col rounded-xl border bg-[#141414] p-4 transition ${
                  noCarrinho ? "border-[#C9A962]/60" : "border-[#262626]"
                }`}
              >
                <div className="flex gap-3">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-[#262626] bg-[#0A0A0A]">
                    {p.imagem ? (
                      <ProductImage
                        src={p.imagem}
                        alt={p.nome}
                        width={64}
                        height={64}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="grid h-full w-full place-items-center text-[#333]">
                        <Package className="h-5 w-5" />
                      </span>
                    )}
                  </div>

                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-medium text-[#F5F5F5]">{p.nome}</h3>
                    <p className="mt-0.5 text-[11px] text-[#525252]">
                      {p.sku ?? "sem SKU"}
                      {p.categoria ? ` · ${p.categoria}` : ""}
                    </p>
                    <p className="mt-1 text-[11px] text-[#6F6F6F]">
                      {p.stock === null
                        ? "Stock sob consulta"
                        : semStock
                          ? "Sem stock nesta província"
                          : `${p.stock} un. disponíveis`}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex items-end justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wide text-[#525252]">
                      Preço de aquisição
                    </p>
                    <p className="text-lg font-light text-[#C9A962]">
                      {formatCurrency(p.preco_grosso)}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-[#6F6F6F]">
                      <span className="line-through">{formatCurrency(p.preco_loja)}</span>
                      <span className="text-[#333]">·</span>
                      <span className="text-[#4ADE80]">
                        lucro {formatCurrency(p.lucro_unidade)}/un
                      </span>
                      <span className="text-[#4ADE80]">{Math.round(p.margem_pct)}%</span>
                    </p>
                  </div>

                  {noCarrinho ? (
                    <div className="flex items-center gap-1 rounded-lg border border-[#333]">
                      <button
                        type="button"
                        onClick={() => mudar(p, -p.minimo)}
                        aria-label="Diminuir"
                        className="grid h-8 w-8 place-items-center text-[#A3A3A3] transition hover:text-[#C9A962]"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <input
                        value={qtd}
                        onChange={(e) => definir(p, e.target.value)}
                        inputMode="numeric"
                        aria-label={`Quantidade de ${p.nome}`}
                        className="w-12 border-x border-[#333] bg-transparent py-1.5 text-center text-sm text-[#F5F5F5] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => mudar(p, p.minimo)}
                        aria-label="Aumentar"
                        className="grid h-8 w-8 place-items-center text-[#A3A3A3] transition hover:text-[#C9A962]"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remover(p.product_id)}
                        aria-label="Remover"
                        className="grid h-8 w-8 place-items-center text-[#525252] transition hover:text-[#F87171]"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => adicionar(p)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#C9A962]/50 bg-[#C9A962]/5 px-3 py-1.5 text-xs font-medium text-[#C9A962] transition hover:bg-[#C9A962] hover:text-[#0A0A0A]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Adicionar
                    </button>
                  )}
                </div>

                {noCarrinho && (
                  <p className="mt-2 text-[10px] text-[#6F6F6F]">
                    {qtd} un. · paga {formatCurrency(p.preco_grosso * qtd)} · vende{" "}
                    {formatCurrency(p.preco_loja * qtd)} · lucra{" "}
                    <span className="text-[#4ADE80]">
                      {formatCurrency(p.lucro_unidade * qtd)}
                    </span>{" "}
                    (mínimo {p.minimo})
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* ------------------------------------------------- A CONTA DO PEDIDO */}
      {linhas.length > 0 && (
        <section className="mt-8 rounded-xl border border-[#262626] bg-[#111] p-4 sm:p-5">
          <h2 className="text-sm font-medium text-[#F5F5F5]">A conta do seu pedido</h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-[#6F6F6F]">
            O que paga hoje, o que recebe se vender ao preço de cliente final, e o que fica
            para si. A margem é o lucro sobre aquilo que paga — não sobre o preço da loja.
          </p>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-left text-[12.5px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-[#525252]">
                  <th className="pb-2 pr-3 font-medium">Produto</th>
                  <th className="pb-2 pr-3 text-right font-medium">Cliente</th>
                  <th className="pb-2 pr-3 text-right font-medium">Revendedor</th>
                  <th className="pb-2 pr-3 text-right font-medium">Lucro/un.</th>
                  <th className="pb-2 pr-3 text-right font-medium">Margem</th>
                  <th className="pb-2 pr-3 text-right font-medium">Qtd</th>
                  <th className="pb-2 text-right font-medium">Lucro</th>
                </tr>
              </thead>
              <tbody className="text-[#D4D4D4]">
                {linhas.map((l) => (
                  <tr key={l.produto.product_id} className="border-t border-[#1F1F1F]">
                    <td className="py-2 pr-3">
                      <span className="line-clamp-1">{l.produto.nome}</span>
                      {l.produto.reducao > 0 && (
                        <span className="block text-[10px] text-[#525252]">
                          −{formatCurrency(l.produto.reducao)} sobre a tabela
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right text-[#8A8A8A]">
                      {formatCurrency(l.produto.preco_loja)}
                    </td>
                    <td className="py-2 pr-3 text-right text-[#C9A962]">
                      {formatCurrency(l.produto.preco_grosso)}
                    </td>
                    <td className="py-2 pr-3 text-right text-[#4ADE80]">
                      {formatCurrency(l.produto.lucro_unidade)}
                    </td>
                    <td className="py-2 pr-3 text-right text-[#4ADE80]">
                      {Math.round(l.produto.margem_pct)}%
                    </td>
                    <td className="py-2 pr-3 text-right">{l.quantidade}</td>
                    <td className="py-2 text-right font-medium text-[#4ADE80]">
                      {formatCurrency(l.produto.lucro_unidade * l.quantidade)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { rotulo: "Compra", valor: formatCurrency(totalValor), cor: "text-[#C9A962]" },
              { rotulo: "Venda", valor: formatCurrency(totalVenda), cor: "text-[#D4D4D4]" },
              { rotulo: "Lucro total", valor: formatCurrency(totalLucro), cor: "text-[#4ADE80]" },
              {
                rotulo: "Margem",
                valor: `${Math.round(margemTotal)}%`,
                cor: "text-[#4ADE80]",
              },
            ].map((c) => (
              <div key={c.rotulo} className="rounded-lg border border-[#1F1F1F] bg-[#0A0A0A] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-[#525252]">{c.rotulo}</p>
                <p className={`mt-0.5 text-sm font-medium ${c.cor}`}>{c.valor}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* --------------------------------------------------------- BARRA FIXA */}
      {linhas.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#262626] bg-[#0A0A0A]/95 backdrop-blur">
          <div className="mx-auto max-w-6xl px-4 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-xs text-[#A3A3A3]">
                  <ShoppingCart className="h-3.5 w-3.5 text-[#C9A962]" />
                  {linhas.length} de {minimoProdutos} produtos · {totalUnidades} unidades
                  <button
                    type="button"
                    onClick={() => setCarrinho({})}
                    className="inline-flex items-center gap-1 text-[10px] text-[#525252] hover:text-[#F87171]"
                  >
                    <Trash2 className="h-3 w-3" />
                    limpar
                  </button>
                </p>
                {faltam > 0 && (
                  <p className="mt-1 text-[11px] text-[#E3D5A7]">
                    Faltam {faltam} {faltam === 1 ? "produto" : "produtos"} para poder enviar o
                    pedido.
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

              <div className="flex items-end gap-4 text-right">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-[#525252]">Compra</p>
                  <p className="text-sm font-medium text-[#C9A962]">
                    {formatCurrency(totalValor)}
                  </p>
                </div>
                <div className="hidden sm:block">
                  <p className="text-[10px] uppercase tracking-wide text-[#525252]">Venda</p>
                  <p className="text-sm font-medium text-[#D4D4D4]">
                    {formatCurrency(totalVenda)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-[#525252]">Lucro</p>
                  <p className="text-sm font-medium text-[#4ADE80]">
                    {formatCurrency(totalLucro)}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={enviarPedido}
                disabled={aEnviar || faltam > 0}
                className="inline-flex items-center gap-2 rounded-lg bg-[#C9A962] px-5 py-2.5 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A] disabled:opacity-50"
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
