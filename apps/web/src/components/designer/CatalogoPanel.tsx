"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Package, Search } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { listarProvincias, type Provincia } from "@/lib/provincias";
import { novaImagem, novoTexto } from "@/lib/designer/types";
import type { Editor } from "@/lib/designer/store";
import { Seccao } from "./ToolPanels";

/**
 * Catálogo dentro do estúdio.
 *
 * O gestor procura o produto e insere-o na composição sem sair do editor e sem
 * descarregar/voltar a carregar a fotografia. Usa os dados reais do catálogo:
 * nome, referência, preço efetivo (promocional quando existe) e a fotografia
 * principal, respeitando a província do produto.
 */

interface ProdutoCatalogo {
  id: string;
  sku: string | null;
  name: string;
  category_id: string | null;
  official_price: number | string;
  promotional_price: number | string | null;
  provincia_id: string | null;
  product_images: { url: string | null; is_primary: boolean; sort_order: number }[];
}

interface Categoria {
  id: string;
  name: string;
}

function precoEfetivo(p: ProdutoCatalogo): number {
  const promo = p.promotional_price === null ? null : Number(p.promotional_price);
  return promo ?? Number(p.official_price);
}

function dinheiro(v: number): string {
  return `${new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 0 }).format(v)} Kz`;
}

function imagemPrincipal(p: ProdutoCatalogo): string | null {
  const ordenadas = [...(p.product_images ?? [])].sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order
  );
  return ordenadas.find((i) => i.url)?.url ?? null;
}

function medirImagem(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = url;
  });
}

export function CatalogoPanel({
  editor,
  largura,
  altura,
}: {
  editor: Editor;
  largura: number;
  altura: number;
}) {
  const [produtos, setProdutos] = useState<ProdutoCatalogo[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [provincias, setProvincias] = useState<Provincia[]>([]);
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState("");
  const [provincia, setProvincia] = useState("");
  const [aCarregar, setACarregar] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [incluirPreco, setIncluirPreco] = useState(true);
  const [aInserir, setAInserir] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const pedidoAtual = useRef(0);

  useEffect(() => {
    const supabase = createClientBrowser();
    (async () => {
      const [{ data: cats }, provs] = await Promise.all([
        supabase
          .from("categories")
          .select("id, name")
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true }),
        listarProvincias(supabase),
      ]);
      setCategorias((cats ?? []) as Categoria[]);
      setProvincias(provs);
    })();
  }, []);

  const carregar = useCallback(async () => {
    const meu = ++pedidoAtual.current;
    setACarregar(true);
    setErro(null);

    const supabase = createClientBrowser();
    let consulta = supabase
      .from("products")
      .select(
        "id, sku, name, category_id, official_price, promotional_price, provincia_id, product_images(url, is_primary, sort_order)"
      )
      .eq("is_active", true)
      .order("name", { ascending: true })
      .limit(60);

    const termo = busca.trim().replace(/[,()%]/g, "");
    if (termo) consulta = consulta.or(`name.ilike.%${termo}%,sku.ilike.%${termo}%`);
    if (categoria) consulta = consulta.eq("category_id", categoria);
    if (provincia) consulta = consulta.or(`provincia_id.is.null,provincia_id.eq.${provincia}`);

    const { data, error } = await consulta;
    if (meu !== pedidoAtual.current) return;

    if (error) {
      setErro(error.message);
      setProdutos([]);
    } else {
      setProdutos((data ?? []) as unknown as ProdutoCatalogo[]);
    }
    setACarregar(false);
  }, [busca, categoria, provincia]);

  useEffect(() => {
    const t = setTimeout(() => void carregar(), busca ? 320 : 0);
    return () => clearTimeout(t);
  }, [carregar, busca]);

  const inserir = useCallback(
    async (p: ProdutoCatalogo) => {
      const url = imagemPrincipal(p);
      setAviso(null);
      setAInserir(p.id);

      try {
        // As medidas reais evitam a fotografia esticada, que é o erro mais
        // visível num cartaz.
        const medidas = url ? await medirImagem(url) : { w: 0, h: 0 };
        const base = Math.min(largura * 0.62, 720);
        const razao = medidas.w > 0 && medidas.h > 0 ? medidas.w / medidas.h : 1;
        const w = Math.round(base);
        const h = Math.round(base / razao);
        const x = Math.round((largura - w) / 2);
        const y = Math.round(altura * 0.32 - h / 2);

        if (url) {
          editor.adicionarElemento(
            novaImagem(url, {
              name: p.name,
              storagePath: null,
              w,
              h,
              x,
              y: Math.max(24, y),
              fit: "contain",
            })
          );
        }

        const tamanho = Math.max(24, Math.round(largura * 0.045));
        editor.adicionarElemento(
          novoTexto({
            name: `Nome · ${p.name}`,
            text: p.name,
            fontSize: tamanho,
            fontWeight: 600,
            w: Math.round(largura * 0.84),
            h: Math.round(tamanho * 2.2),
            x: Math.round(largura * 0.08),
            y: Math.min(altura - tamanho * 3.4, Math.max(24, y) + h + Math.round(largura * 0.03)),
            align: "center",
          })
        );

        if (incluirPreco) {
          const promo = p.promotional_price !== null && Number(p.promotional_price) < Number(p.official_price);
          editor.adicionarElemento(
            novoTexto({
              name: `Preço · ${p.name}`,
              text: `${promo ? "Promoção · " : ""}${dinheiro(precoEfetivo(p))}`,
              fontSize: Math.max(20, Math.round(largura * 0.032)),
              fontWeight: 500,
              color: "#C9A962",
              w: Math.round(largura * 0.84),
              h: Math.round(tamanho * 1.8),
              x: Math.round(largura * 0.08),
              y: Math.min(
                altura - tamanho * 1.6,
                Math.max(24, y) + h + Math.round(largura * 0.03) + Math.round(tamanho * 2.4)
              ),
              align: "center",
            })
          );
        }

        setAviso(`“${p.name}” inserido no projeto.`);
      } catch {
        setAviso("Não foi possível inserir este produto.");
      } finally {
        setAInserir(null);
      }
    },
    [altura, editor, incluirPreco, largura]
  );

  const semImagem = useMemo(
    () => produtos.filter((p) => !imagemPrincipal(p)).length,
    [produtos]
  );

  return (
    <div>
      <Seccao titulo="Usar imagem deste produto">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[#5F5F5F]" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome ou referência"
            className="w-full rounded-lg border border-[#2A2A2A] bg-[#111] py-2 pl-8 pr-2 text-xs text-[#E5E5E5] outline-none placeholder:text-[#5F5F5F] focus:border-[#C9A962]"
          />
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            className="rounded-lg border border-[#2A2A2A] bg-[#111] px-2 py-2 text-[11px] text-[#E5E5E5] outline-none focus:border-[#C9A962]"
            aria-label="Filtrar por categoria"
          >
            <option value="">Todas as categorias</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            value={provincia}
            onChange={(e) => setProvincia(e.target.value)}
            className="rounded-lg border border-[#2A2A2A] bg-[#111] px-2 py-2 text-[11px] text-[#E5E5E5] outline-none focus:border-[#C9A962]"
            aria-label="Filtrar por província"
          >
            <option value="">Todas as províncias</option>
            {provincias.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </div>

        <label className="mt-3 flex items-center gap-2 text-[11px] text-[#A3A3A3]">
          <input
            type="checkbox"
            checked={incluirPreco}
            onChange={(e) => setIncluirPreco(e.target.checked)}
            className="h-3.5 w-3.5 accent-[#C9A962]"
          />
          Inserir também o preço
        </label>

        {aviso && <p className="mt-2 text-[11px] text-[#C9A962]">{aviso}</p>}
        {erro && <p className="mt-2 text-[11px] text-[#F87171]">Catálogo indisponível: {erro}</p>}
      </Seccao>

      <Seccao titulo={`Produtos (${produtos.length})`}>
        {aCarregar ? (
          <div className="flex items-center justify-center gap-2 py-8 text-[11px] text-[#6F6F6F]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> A carregar catálogo
          </div>
        ) : produtos.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-[#2A2A2A] py-8 text-center">
            <Package className="h-6 w-6 text-[#3F3F3F]" />
            <p className="px-4 text-xs text-[#6F6F6F]">
              Nenhum produto encontrado com estes filtros.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {produtos.map((p) => {
              const url = imagemPrincipal(p);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => void inserir(p)}
                  disabled={aInserir !== null}
                  title={`Usar imagem de ${p.name}`}
                  className="group overflow-hidden rounded-lg border border-[#2A2A2A] bg-[#111] text-left transition hover:border-[#C9A962] disabled:opacity-60"
                >
                  <div className="relative aspect-square w-full bg-[#0A0A0A]">
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt={p.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-[10px] text-[#4A4A4A]">
                        sem imagem
                      </div>
                    )}
                    {aInserir === p.id && (
                      <div className="absolute inset-0 grid place-items-center bg-black/60">
                        <Loader2 className="h-4 w-4 animate-spin text-[#C9A962]" />
                      </div>
                    )}
                  </div>
                  <div className="p-1.5">
                    <p className="truncate text-[10px] text-[#D4D4D4] group-hover:text-[#C9A962]">
                      {p.name}
                    </p>
                    <p className="truncate text-[9px] text-[#5F5F5F]">
                      {p.sku ?? "sem referência"} · {dinheiro(precoEfetivo(p))}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {!aCarregar && semImagem > 0 && (
          <p className="mt-2 text-[10px] text-[#5F5F5F]">
            {semImagem} produto(s) sem fotografia — o nome e o preço são inseridos na mesma.
          </p>
        )}
      </Seccao>

      <Seccao titulo="Como funciona">
        <p className="text-[11px] leading-relaxed text-[#8A8A8A]">
          Escolher um produto coloca a fotografia, o nome e (se quiser) o preço na página atual.
          Depois ajusta o tamanho e o recorte com as alças, como em qualquer imagem.
        </p>
      </Seccao>
    </div>
  );
}
