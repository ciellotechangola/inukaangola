"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { AlertTriangle, ImagePlus, Package, Plus, Trash2, Upload, X } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { setProductStock } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { mensagemDeErro } from "@/lib/erros";
import { listarProvincias, faltaPatchProvincial, AVISO_PATCH_PROVINCIAL, type Provincia } from "@/lib/provincias";
import ProductImage from "@/components/ProductImage";
import TabelaResponsiva from "@/components/TabelaResponsiva";

interface Category {
  id: string;
  name: string;
}

interface ImagemProduto {
  id: string;
  url: string | null;
  storage_path: string;
  is_primary: boolean;
  sort_order?: number;
}

interface LinhaStock {
  quantity: number;
  provincia_id: string | null;
}

/** O que a eliminação vai arrastar. Vem de `impacto_eliminar_produto`. */
interface ImpactoEliminar {
  product_id: string;
  name: string;
  order_items: number;
  sale_items: number;
  reservation_items: number;
  discount_requests: number;
  images: number;
  favorites: number;
  /** Registos que só têm este produto — desaparecem por inteiro no modo forçado. */
  orders_emptied?: number;
  sales_emptied?: number;
  reservations_emptied?: number;
}

interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  category_id: string | null;
  description: string | null;
  official_price: number;
  promotional_price: number | null;
  is_active: boolean;
  provincia_id: string | null;
  inventory?: LinhaStock[] | LinhaStock | null;
  images?: ImagemProduto[];
}

interface Movimento {
  id: string;
  product_id: string;
  type: string;
  quantity: number;
  previous_quantity: number;
  new_quantity: number;
  notes: string | null;
  created_at: string;
  provincia_id: string | null;
  created_by: string | null;
}

const BUCKET = "product-images";
const MAX_BYTES = 5 * 1024 * 1024;

const TIPO_MOVIMENTO: Record<string, string> = {
  in: "Entrada",
  out: "Saída",
  adjustment: "Ajuste",
  return: "Devolução",
  correction: "Correção",
  reservation: "Reserva",
  release: "Libertação",
};

function linhasDeStock(p: ProductRow): LinhaStock[] {
  if (!p.inventory) return [];
  return Array.isArray(p.inventory) ? p.inventory : [p.inventory];
}

/** Quantidade do produto na província pedida (`null` = armazém-sede). */
function stockOf(p: ProductRow, provinciaId: string | null): number | null {
  const linha = linhasDeStock(p).find((l) => (l.provincia_id ?? null) === provinciaId);
  return linha ? linha.quantity : null;
}

function imagemPrincipal(p: ProductRow): string | null {
  const lista = p.images ?? [];
  const primaria = lista.find((i) => i.is_primary) ?? lista[0];
  return primaria?.url ?? null;
}

function extensao(nome: string, tipo: string): string {
  const doNome = nome.includes(".") ? nome.split(".").pop()!.toLowerCase() : "";
  if (doNome && /^[a-z0-9]{1,5}$/.test(doNome)) return doNome;
  const porTipo: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
  };
  return porTipo[tipo] ?? "jpg";
}

/**
 * Fotografias do produto — várias, não uma.
 *
 * Duas proveniências, uma só coluna lida pelo site (`product_images.url`):
 *  - ficheiro → Storage `product-images/<produtoId>/<uuid>.<ext>`; o bucket é
 *    público, por isso o URL público serve directamente.
 *  - URL colado pela gerência → fica tal e qual (`storage_path` guarda o
 *    próprio URL; nada no site o usa para renderizar).
 *
 * A **capa** é a linha com `is_primary`. O catálogo e a página do produto
 * procuram-na primeiro; as restantes aparecem na galeria, pela ordem de
 * `sort_order`.
 */
function validarFoto(f: File) {
  if (!f.type.startsWith("image/")) throw new Error(`«${f.name}» não é uma imagem.`);
  if (f.size > MAX_BYTES) throw new Error(`«${f.name}» passa dos 5 MB.`);
}

async function enviarFicheiro(
  supabase: ReturnType<typeof createClientBrowser>,
  productId: string,
  ficheiro: File
): Promise<{ url: string; caminho: string }> {
  validarFoto(ficheiro);

  const ext = extensao(ficheiro.name, ficheiro.type);
  const caminho = `${productId}/${crypto.randomUUID()}.${ext}`;

  const up = await supabase.storage.from(BUCKET).upload(caminho, ficheiro, {
    contentType: ficheiro.type,
    upsert: false,
  });
  if (up.error) throw new Error(up.error.message);

  return { url: supabase.storage.from(BUCKET).getPublicUrl(caminho).data.publicUrl, caminho };
}

/**
 * Acrescenta fotografias a um produto já criado.
 *
 * Devolve quantas entraram. Se a base recusar o INSERT, os ficheiros que já
 * subiram são apagados — um ficheiro órfão no Storage não se encontra depois.
 */
async function adicionarFotos(
  productId: string,
  ficheiros: File[],
  urls: string[] = []
): Promise<number> {
  const supabase = createClientBrowser();

  const { count } = await supabase
    .from("product_images")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);

  let ordem = count ?? 0;
  const novas: {
    product_id: string;
    storage_path: string;
    url: string;
    is_primary: boolean;
    sort_order: number;
  }[] = [];
  const subidos: string[] = [];

  try {
    for (const ficheiro of ficheiros) {
      const { url, caminho } = await enviarFicheiro(supabase, productId, ficheiro);
      subidos.push(caminho);
      novas.push({
        product_id: productId,
        storage_path: caminho,
        url,
        is_primary: false,
        sort_order: ordem++,
      });
    }

    for (const bruto of urls) {
      const url = bruto.trim();
      if (!url) continue;
      novas.push({
        product_id: productId,
        storage_path: url,
        url,
        is_primary: false,
        sort_order: ordem++,
      });
    }

    if (novas.length === 0) return 0;

    // Primeira fotografia do produto é a capa.
    if ((count ?? 0) === 0) novas[0].is_primary = true;

    const { error } = await supabase.from("product_images").insert(novas);
    if (error) throw new Error(error.message);

    return novas.length;
  } catch (e) {
    if (subidos.length > 0) await supabase.storage.from(BUCKET).remove(subidos);
    throw e;
  }
}

/**
 * Apaga uma fotografia (linha e ficheiro).
 */
async function apagarFoto(img: ImagemProduto, productId: string) {
  const supabase = createClientBrowser();

  if (img.storage_path && !/^https?:\/\//i.test(img.storage_path)) {
    await supabase.storage.from(BUCKET).remove([img.storage_path]);
  }

  const { error } = await supabase.from("product_images").delete().eq("id", img.id);
  if (error) throw new Error(error.message);

  // Se era a capa, a primeira que sobrar passa a ser.
  if (img.is_primary) {
    const { data: restantes } = await supabase
      .from("product_images")
      .select("id")
      .eq("product_id", productId)
      .order("sort_order")
      .limit(1);
    const proxima = (restantes ?? [])[0] as { id: string } | undefined;
    if (proxima) {
      await supabase.from("product_images").update({ is_primary: true }).eq("id", proxima.id);
    }
  }
}

/** Escolhe a capa (a que aparece no catálogo). */
async function definirCapa(productId: string, imagemId: string) {
  const supabase = createClientBrowser();

  // Marca primeiro a nova capa e só depois limpa as outras: se a segunda
  // chamada falhar, o produto fica com duas capas (inofensivo — o catálogo
  // escolhe a primeira) em vez de ficar sem nenhuma.
  const { error } = await supabase
    .from("product_images")
    .update({ is_primary: true })
    .eq("id", imagemId);
  if (error) throw new Error(error.message);

  await supabase
    .from("product_images")
    .update({ is_primary: false })
    .eq("product_id", productId)
    .neq("id", imagemId);
}

export default function ManagerProductsPage() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [provincias, setProvincias] = useState<Provincia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  // Produto a ser editado. `null` = o formulário está a criar um novo.
  const [editando, setEditando] = useState<ProductRow | null>(null);

  // Identidade provincial de quem está a gerir.
  const [minhaProvincia, setMinhaProvincia] = useState<string | null>(null);
  const [souNacional, setSouNacional] = useState(true);

  // Província cujo stock está a ser mostrado/alterado.
  // `""` representa o armazém-sede (provincia_id NULL).
  const [provinciaStock, setProvinciaStock] = useState<string>("");
  const [movimentos, setMovimentos] = useState<Movimento[]>([]);

  const [form, setForm] = useState({
    name: "",
    sku: "",
    category_id: "",
    description: "",
    official_price: "",
    promotional_price: "",
    stock: "0",
    imagemUrl: "",
    provincia_id: "",
  });

  const [ficheiros, setFicheiros] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const inputFicheiro = useRef<HTMLInputElement>(null);

  // Modal de fotografias de um produto já existente
  const [alvo, setAlvo] = useState<ProductRow | null>(null);
  const [alvoFicheiros, setAlvoFicheiros] = useState<File[]>([]);
  const [alvoPreviews, setAlvoPreviews] = useState<string[]>([]);
  const [alvoUrl, setAlvoUrl] = useState("");
  const [aGuardarImagem, setAGuardarImagem] = useState(false);

  // Confirmação de eliminação: primeiro o impacto, depois a decisão.
  const [aEliminar, setAEliminar] = useState<{
    produto: ProductRow;
    impacto: ImpactoEliminar;
  } | null>(null);
  const [aApagar, setAApagar] = useState(false);
  /** No aviso de eliminação: apagar também o histórico deste produto. */
  const [forcarHistorico, setForcarHistorico] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClientBrowser();
    const [{ data: prods, error: pErr }, { data: cats }, lista, { data: userData }] =
      await Promise.all([
        supabase
          .from("products")
          .select(
            "id, name, sku, category_id, description, official_price, promotional_price, is_active, provincia_id, inventory(quantity, provincia_id), images:product_images(id, url, storage_path, is_primary)"
          )
          .order("created_at", { ascending: false }),
        supabase.from("categories").select("id, name").order("name"),
        listarProvincias(supabase),
        supabase.auth.getUser(),
      ]);

    if (pErr) setError(pErr.message);
    setProducts((prods ?? []) as ProductRow[]);
    setCategories((cats ?? []) as Category[]);
    setProvincias(lista);

    if (userData?.user) {
      const { data: perfil } = await supabase
        .from("profiles")
        .select("provincia_id, is_national_admin")
        .eq("id", userData.user.id)
        .maybeSingle();
      const p = perfil as { provincia_id: string | null; is_national_admin: boolean } | null;
      const nacional = !p || p.is_national_admin || p.provincia_id === null;
      setSouNacional(nacional);
      setMinhaProvincia(p?.provincia_id ?? null);
      // Mostrar, por omissão, o stock da província de quem está a gerir.
      setProvinciaStock((atual) => atual || (p?.provincia_id ?? ""));
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Histórico de movimentos da província selecionada.
  useEffect(() => {
    const supabase = createClientBrowser();
    let cancelado = false;

    const query = supabase
      .from("inventory_movements")
      .select(
        "id, product_id, type, quantity, previous_quantity, new_quantity, notes, created_at, provincia_id, created_by"
      )
      .order("created_at", { ascending: false })
      .limit(25);

    const filtrada = provinciaStock ? query.eq("provincia_id", provinciaStock) : query.is("provincia_id", null);

    filtrada.then(({ data }) => {
      if (!cancelado) setMovimentos((data ?? []) as Movimento[]);
    });

    return () => {
      cancelado = true;
    };
  }, [provinciaStock]);

  function escolherFicheiros(e: ChangeEvent<HTMLInputElement>, paraModal: boolean) {
    const lista = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (lista.length === 0) return;

    try {
      for (const f of lista) validarFoto(f);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ficheiro inválido.");
      return;
    }

    setError("");
    const novas = lista.map((f) => URL.createObjectURL(f));

    if (paraModal) {
      setAlvoFicheiros((prev) => [...prev, ...lista]);
      setAlvoPreviews((prev) => [...prev, ...novas]);
    } else {
      setFicheiros((prev) => [...prev, ...lista]);
      setPreviews((prev) => [...prev, ...novas]);
    }
  }

  function limparImagem(paraModal: boolean) {
    if (paraModal) {
      alvoPreviews.forEach((p) => URL.revokeObjectURL(p));
      setAlvoFicheiros([]);
      setAlvoPreviews([]);
      setAlvoUrl("");
    } else {
      previews.forEach((p) => URL.revokeObjectURL(p));
      setFicheiros([]);
      setPreviews([]);
      setForm((f) => ({ ...f, imagemUrl: "" }));
    }
  }

  function formVazio() {
    return {
      name: "",
      sku: "",
      category_id: "",
      description: "",
      official_price: "",
      promotional_price: "",
      stock: "0",
      imagemUrl: "",
      provincia_id: souNacional ? "" : (minhaProvincia ?? ""),
    };
  }

  function fecharFormulario() {
    limparImagem(false);
    setEditando(null);
    setShowForm(false);
    setForm(formVazio());
  }

  function abrirEdicao(p: ProductRow) {
    setError("");
    setNotice("");
    setEditando(p);
    setForm({
      name: p.name,
      sku: p.sku ?? "",
      category_id: p.category_id ?? "",
      description: p.description ?? "",
      official_price: String(p.official_price ?? ""),
      promotional_price: p.promotional_price === null ? "" : String(p.promotional_price),
      stock: "0",
      imagemUrl: "",
      provincia_id: p.provincia_id ?? "",
    });
    limparImagem(false);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleGuardar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");

    if (!form.name.trim()) {
      setError("Indique o nome do produto.");
      return;
    }
    const price = Number(form.official_price);
    if (!price || price <= 0) {
      setError("Indique um preço oficial válido.");
      return;
    }

    setSaving(true);
    const supabase = createClientBrowser();

    // Campos comuns à criação e à edição. O stock fica de fora de propósito:
    // é por província e muda-se no botão «Stock», que deixa rasto em
    // inventory_movements.
    const campos = {
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      category_id: form.category_id || null,
      description: form.description.trim() || null,
      official_price: price,
      promotional_price: form.promotional_price ? Number(form.promotional_price) : null,
      // Produto nacional (NULL) ou de uma província. Um gestor provincial
      // não pode escolher outra: o servidor corrige-o de qualquer forma.
      provincia_id: form.provincia_id || null,
    };

    if (editando) {
      const { error: upErr } = await supabase
        .from("products")
        .update(campos)
        .eq("id", editando.id);

      if (upErr) {
        setError(upErr.message);
        setSaving(false);
        return;
      }

      const avisos: string[] = [];
      if (ficheiros.length > 0 || form.imagemUrl.trim()) {
        try {
          await adicionarFotos(editando.id, ficheiros, [form.imagemUrl]);
        } catch (err) {
          avisos.push(
            `as fotografias falharam: ${err instanceof Error ? err.message : "erro"}`
          );
        }
      }

      setNotice(
        avisos.length > 0 ? `Produto actualizado — ${avisos.join(" · ")}.` : "Produto actualizado."
      );
      fecharFormulario();
      setSaving(false);
      await load();
      return;
    }

    const { data: created, error: insErr } = await supabase
      .from("products")
      .insert({
        ...campos,
        is_active: true,
      })
      .select("id")
      .single();

    if (insErr || !created) {
      setError(insErr?.message ?? "Não foi possível criar o produto.");
      setSaving(false);
      return;
    }

    const productId = (created as { id: string }).id;
    const avisos: string[] = [];

    // Fotografias primeiro: é o que o utilizador pediu para ficar guardado.
    if (ficheiros.length > 0 || form.imagemUrl.trim()) {
      try {
        await adicionarFotos(productId, ficheiros, [form.imagemUrl]);
      } catch (err) {
        avisos.push(
          `produto criado, mas as fotografias falharam: ${err instanceof Error ? err.message : "erro"}`
        );
      }
    }

    try {
      await setProductStock(
        productId,
        Number(form.stock) || 0,
        "Stock inicial",
        form.provincia_id || provinciaStock || null
      );
    } catch (err) {
      avisos.push(
        `stock inicial falhou: ${err instanceof Error ? err.message : "erro"}`
      );
    }

    setNotice(
      avisos.length > 0 ? `Produto criado — ${avisos.join(" · ")}.` : "Produto criado com sucesso."
    );
    fecharFormulario();
    setSaving(false);
    await load();
  }

  /**
   * Eliminar um produto — mesmo que já esteja em encomendas ou vendas.
   *
   * A base de dados guarda o nome e o preço nos registos históricos e deixa
   * `product_id` a NULL (migração 0013). Antes de apagar mostramos o impacto:
   * o gestor vê o que vai acontecer e confirma. Não há bloqueio.
   */
  async function pedirEliminar(p: ProductRow) {
    setError("");
    setNotice("");

    const supabase = createClientBrowser();
    const { data, error } = await supabase.rpc("impacto_eliminar_produto", {
      p_product_id: p.id,
    });

    if (error) {
      setError(mensagemDeErro(error));
      return;
    }

    setForcarHistorico(false);
    setAEliminar({ produto: p, impacto: data as ImpactoEliminar });
  }

  /**
   * `forcar` apaga também o histórico deste produto (linhas de encomenda,
   * venda, reserva e pedidos de desconto) e os registos que ficaram vazios.
   * É para produtos fictícios, de demonstração ou de teste — não para um
   * artigo real que sai de linha.
   */
  async function confirmarEliminar(forcar = false) {
    if (!aEliminar) return;

    const { produto } = aEliminar;
    setAApagar(true);
    setError("");
    setNotice("");

    const supabase = createClientBrowser();
    // Os ficheiros do Storage primeiro: se o produto sair e a remoção falhar,
    // ficam órfãos sem forma de os encontrar.
    const caminhos = (produto.images ?? []).map((i) => i.storage_path).filter(Boolean);

    try {
      const { data, error } = await supabase.rpc("eliminar_produto", {
        p_product_id: produto.id,
        p_forcar: forcar,
      });
      if (error) throw new Error(error.message);

      if (caminhos.length > 0) await supabase.storage.from(BUCKET).remove(caminhos);

      if (editando?.id === produto.id) fecharFormulario();
      if (alvo?.id === produto.id) fecharModal();

      setAEliminar(null);

      const apagados = (data as { apagados?: Record<string, number> } | null)?.apagados;
      const partes = forcar
        ? [
            apagados?.linhas_encomenda ? `${apagados.linhas_encomenda} linha(s) de encomenda` : "",
            apagados?.linhas_venda ? `${apagados.linhas_venda} linha(s) de venda` : "",
            apagados?.encomendas ? `${apagados.encomendas} encomenda(s)` : "",
            apagados?.vendas ? `${apagados.vendas} venda(s)` : "",
            apagados?.reservas ? `${apagados.reservas} reserva(s)` : "",
          ].filter(Boolean)
        : [];

      setNotice(
        forcar
          ? `«${produto.name}» eliminado do catálogo${partes.length ? ` e do histórico (${partes.join(" · ")})` : " e do histórico"}.`
          : `«${produto.name}» eliminado do catálogo. O histórico das vendas ficou guardado.`
      );
      await load();
    } catch (e) {
      setError(
        mensagemDeErro(
          e,
          forcar ? "supabase/PATCH_ELIMINAR_FORCADO.sql" : "supabase/PATCH_PERFIS_LOJA.sql"
        )
      );
    } finally {
      setAApagar(false);
    }
  }

  /** Relê as fotografias do produto aberto no modal (sem fechar o modal). */
  async function recarregarAlvo(productId: string) {
    const supabase = createClientBrowser();
    const { data } = await supabase
      .from("product_images")
      .select("id, url, storage_path, is_primary, sort_order")
      .eq("product_id", productId)
      .order("sort_order");
    setAlvo((atual) =>
      atual && atual.id === productId ? { ...atual, images: (data ?? []) as ImagemProduto[] } : atual
    );
  }

  async function guardarImagemDoAlvo() {
    if (!alvo) return;
    if (alvoFicheiros.length === 0 && !alvoUrl.trim()) {
      setError("Escolha um ficheiro ou cole um URL.");
      return;
    }
    setAGuardarImagem(true);
    setError("");
    try {
      const entraram = await adicionarFotos(alvo.id, alvoFicheiros, [alvoUrl]);
      setNotice(
        entraram === 1 ? "Fotografia acrescentada." : `${entraram} fotografias acrescentadas.`
      );
      limparImagem(true);
      await recarregarAlvo(alvo.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar a fotografia.");
    } finally {
      setAGuardarImagem(false);
    }
  }

  async function removerFotoDoAlvo(img: ImagemProduto) {
    if (!alvo) return;
    if (!window.confirm("Apagar esta fotografia do produto?")) return;
    setError("");
    try {
      await apagarFoto(img, alvo.id);
      setNotice("Fotografia apagada.");
      await recarregarAlvo(alvo.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível apagar a fotografia.");
    }
  }

  async function capaDoAlvo(img: ImagemProduto) {
    if (!alvo) return;
    setError("");
    try {
      await definirCapa(alvo.id, img.id);
      setNotice("Capa actualizada.");
      await recarregarAlvo(alvo.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível definir a capa.");
    }
  }

  async function handleStock(productId: string, current: number | null) {
    const onde = provinciaStock
      ? (provincias.find((p) => p.id === provinciaStock)?.nome ?? "província")
      : "armazém-sede";
    const input = window.prompt(`Nova quantidade em stock (${onde}):`, String(current ?? 0));
    if (input === null) return;
    const qty = Number(input);
    if (!Number.isFinite(qty) || qty < 0) {
      setError("Quantidade inválida.");
      return;
    }
    try {
      await setProductStock(productId, qty, "Ajuste manual", provinciaStock || null);
      setNotice(`Stock atualizado (${onde}).`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível atualizar o stock.");
    }
  }

  async function toggleActive(product: ProductRow) {
    const supabase = createClientBrowser();
    const { error: upErr } = await supabase
      .from("products")
      .update({ is_active: !product.is_active })
      .eq("id", product.id);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    await load();
  }

  function abrirModal(p: ProductRow) {
    setAlvo(p);
    setAlvoFicheiros([]);
    setAlvoPreviews([]);
    setAlvoUrl("");
    setError("");
  }

  function fecharModal() {
    setAlvo(null);
    alvoPreviews.forEach((p) => URL.revokeObjectURL(p));
    setAlvoFicheiros([]);
    setAlvoPreviews([]);
    setAlvoUrl("");
  }

  const campo =
    "rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none";

  // Só se oferece «apagar do histórico» quando há histórico para apagar.
  const temHistorico =
    !!aEliminar &&
    aEliminar.impacto.order_items +
      aEliminar.impacto.sale_items +
      aEliminar.impacto.reservation_items +
      aEliminar.impacto.discount_requests >
      0;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <Link href="/gerente" className="mb-6 inline-block text-sm text-[#A3A3A3] hover:text-[#C9A962]">
        ← Painel de gestão
      </Link>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-light text-[#F5F5F5]">Produtos e stock</h1>
          <p className="mt-1 text-xs text-[#6F6F6F]">
            O stock é controlado por província. A coluna “Stock” mostra a província escolhida.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={provinciaStock}
            onChange={(e) => setProvinciaStock(e.target.value)}
            disabled={!souNacional}
            className={`${campo} disabled:opacity-60`}
            aria-label="Província do stock"
          >
            <option value="">Armazém-sede</option>
            {provincias.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              if (showForm && !editando) {
                fecharFormulario();
                return;
              }
              setEditando(null);
              limparImagem(false);
              setForm(formVazio());
              setShowForm(true);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-[#C9A962] px-4 py-2 text-sm font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7]"
          >
            <Plus className="h-4 w-4" />
            Novo produto
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-950/50 p-3 text-sm text-red-200">{error}</div>}
      {faltaPatchProvincial(error) && (
        <div className="mb-4 rounded-lg border border-[#C9A962]/40 bg-[#C9A962]/10 p-3 text-sm text-[#E3D5A7]">
          {AVISO_PATCH_PROVINCIAL}
        </div>
      )}
      {notice && <div className="mb-4 rounded-lg bg-green-950/50 p-3 text-sm text-green-200">{notice}</div>}

      {showForm && (
        <form onSubmit={handleGuardar} className="mb-8 rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-lg font-medium text-[#F5F5F5]">
                {editando ? `Editar «${editando.name}»` : "Novo produto"}
              </h2>
              {editando && (
                <p className="mt-1 text-xs text-[#6F6F6F]">
                  O stock não se muda aqui — use o botão «Stock», que fica registado no histórico.
                </p>
              )}
            </div>
            {editando && (
              <button
                type="button"
                onClick={fecharFormulario}
                className="inline-flex items-center gap-1 text-xs text-[#A3A3A3] hover:text-[#F5F5F5]"
              >
                <X className="h-3.5 w-3.5" />
                Cancelar edição
              </button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Nome do produto *"
              className={campo}
            />
            <input
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              placeholder="SKU"
              className={campo}
            />
            <select
              value={form.category_id}
              onChange={(e) => setForm({ ...form, category_id: e.target.value })}
              className={campo}
            >
              <option value="">Sem categoria</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {!editando && (
              <input
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
                type="number"
                min={0}
                placeholder="Stock inicial"
                className={campo}
              />
            )}
            <select
              value={form.provincia_id}
              onChange={(e) => setForm({ ...form, provincia_id: e.target.value })}
              // Um gestor provincial não escolhe: o produto é da sua província.
              disabled={!souNacional}
              className={`${campo} disabled:opacity-60`}
            >
              <option value="">Produto nacional (todas as províncias)</option>
              {provincias.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
            <input
              value={form.official_price}
              onChange={(e) => setForm({ ...form, official_price: e.target.value })}
              type="number"
              min={0}
              placeholder="Preço oficial (Kz) *"
              className={campo}
            />
            <input
              value={form.promotional_price}
              onChange={(e) => setForm({ ...form, promotional_price: e.target.value })}
              type="number"
              min={0}
              placeholder="Preço promocional (Kz)"
              className={campo}
            />
          </div>

          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Descrição"
            rows={3}
            className={`mt-3 w-full ${campo}`}
          />

          {/* ---------------- Fotografias do produto ---------------- */}
          <div className="mt-4 rounded-lg border border-[#2A2A2A] bg-[#141414] p-4">
            <p className="text-sm font-medium text-[#E5E5E5]">Fotografias do produto</p>
            <p className="mb-3 mt-1 text-[11px] text-[#6F6F6F]">
              Pode escolher várias de uma vez. A primeira é a capa (a que aparece no catálogo);
              na galeria do produto deslizam todas.
            </p>

            {editando && (editando.images ?? []).length > 0 && (
              <p className="mb-3 rounded-lg border border-[#2A2A2A] bg-[#0F0F0F] px-3 py-2 text-[11px] text-[#8A8A8A]">
                Este produto já tem {(editando.images ?? []).length}{" "}
                {(editando.images ?? []).length === 1 ? "fotografia" : "fotografias"}. As que
                acrescentar aqui juntam-se a essas — para apagar ou escolher a capa, use o botão
                «Fotos» na lista.
              </p>
            )}

            <div className="flex flex-wrap items-start gap-2">
              {previews.map((src, i) => (
                <div
                  key={src}
                  className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-[#333] bg-[#0A0A0A]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`Pré-visualização ${i + 1}`} className="h-full w-full object-contain p-1" />
                  <span className="absolute bottom-0 left-0 right-0 bg-[#0A0A0A]/80 text-center text-[9px] uppercase tracking-wider text-[#C9A962]">
                    {i === 0 ? "capa" : `foto ${i + 1}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      URL.revokeObjectURL(src);
                      setPreviews((prev) => prev.filter((p) => p !== src));
                      setFicheiros((prev) => prev.filter((_, k) => k !== i));
                    }}
                    aria-label="Tirar esta fotografia"
                    className="absolute right-1 top-1 rounded-full bg-[#0A0A0A]/85 p-0.5 text-[#C9C9C9] hover:text-red-300"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}

              <input
                ref={inputFicheiro}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => escolherFicheiros(e, false)}
              />
              <button
                type="button"
                onClick={() => inputFicheiro.current?.click()}
                className="flex h-24 w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[#404040] text-[#8A8A8A] transition hover:border-[#C9A962] hover:text-[#C9A962]"
              >
                <ImagePlus className="h-5 w-5" />
                <span className="text-[10px]">Juntar fotos</span>
              </button>
            </div>

            <div className="mt-3 space-y-2">
              <input
                value={form.imagemUrl}
                onChange={(e) => setForm({ ...form, imagemUrl: e.target.value })}
                placeholder="…ou cole um URL de uma imagem (https://…)"
                className={`w-full ${campo}`}
              />
              {(previews.length > 0 || form.imagemUrl) && (
                <button
                  type="button"
                  onClick={() => limparImagem(false)}
                  className="text-[11px] text-[#8A8A8A] underline hover:text-[#E5E5E5]"
                >
                  limpar tudo
                </button>
              )}
            </div>

            <p className="mt-3 text-[11px] text-[#525252]">
              Ficheiros até 5 MB cada (JPG, PNG, WebP). Ficam no Storage; o URL serve para usar
              uma imagem que já esteja alojada.
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-[#C9A962] px-6 py-2.5 text-sm font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-60"
            >
              {saving ? "A guardar..." : editando ? "Guardar alterações" : "Guardar produto"}
            </button>
            {editando && (
              <button
                type="button"
                onClick={fecharFormulario}
                className="rounded-lg border border-[#404040] px-5 py-2.5 text-sm text-[#E5E5E5] transition hover:border-[#C9A962] hover:text-[#C9A962]"
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-[#A3A3A3]">A carregar...</p>
      ) : products.length === 0 ? (
        <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-10 text-center">
          <Package className="mx-auto mb-3 h-8 w-8 text-[#404040]" />
          <p className="text-[#A3A3A3]">Ainda não existem produtos. Crie o primeiro.</p>
        </div>
      ) : (
        <TabelaResponsiva
          itens={products}
          chaveDe={(p) => p.id}
          minimo={720}
          colunas={[
            {
              chave: "produto",
              rotulo: "Produto",
              titulo: true,
              celula: (p) => {
                const qty = stockOf(p, provinciaStock || null);
                const imagem = imagemPrincipal(p);
                return (
                  <div>
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded border border-[#262626] bg-[#141414]">
                        {imagem ? (
                          <ProductImage
                            src={imagem}
                            alt={p.name}
                            width={44}
                            height={44}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <Package className="h-4 w-4 text-[#3A3A3A]" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[#F5F5F5]">{p.name}</p>
                        {p.sku && <p className="text-xs text-[#525252]">{p.sku}</p>}
                        <p className="text-[11px] text-[#6F6F6F]">
                          {p.provincia_id
                            ? (provincias.find((x) => x.id === p.provincia_id)?.nome ?? "província")
                            : "Nacional"}
                        </p>
                      </div>
                    </div>

                    {/* No telemóvel as acções ficam aqui: numa coluna à direita
                        ficavam três botões esmagados em 60 px. */}
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-[#232323] pt-2 md:hidden">
                      <button
                        onClick={() => abrirEdicao(p)}
                        className="text-xs text-[#C9A962] hover:underline"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => abrirModal(p)}
                        className="text-xs text-[#C9A962] hover:underline"
                      >
                        Fotos
                      </button>
                      <button
                        onClick={() => handleStock(p.id, qty)}
                        className="text-xs text-[#C9A962] hover:underline"
                      >
                        Stock
                      </button>
                      <button
                        onClick={() => toggleActive(p)}
                        className="text-xs text-[#A3A3A3] hover:text-[#F5F5F5]"
                      >
                        {p.is_active ? "Desativar" : "Ativar"}
                      </button>
                      <button
                        onClick={() => pedirEliminar(p)}
                        className="text-xs text-red-300 hover:text-red-200"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                );
              },
            },
            {
              chave: "preco",
              rotulo: "Preço",
              alinhar: "direita",
              celula: (p) => (
                <span className="text-[#C9A962]">
                  {formatCurrency(Number(p.promotional_price ?? p.official_price))}
                </span>
              ),
            },
            {
              chave: "stock",
              rotulo: "Stock",
              alinhar: "direita",
              celula: (p) => {
                const qty = stockOf(p, provinciaStock || null);
                return <span className="text-[#A3A3A3]">{qty === null ? "—" : qty}</span>;
              },
            },
            {
              chave: "estado",
              rotulo: "Estado",
              celula: (p) => (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    p.is_active ? "bg-green-950/60 text-green-200" : "bg-[#262626] text-[#A3A3A3]"
                  }`}
                >
                  {p.is_active ? "Ativo" : "Inativo"}
                </span>
              ),
            },
            {
              chave: "acoes",
              rotulo: "",
              alinhar: "direita",
              celula: (p) => {
                const qty = stockOf(p, provinciaStock || null);
                return (
                  <>
                    <button
                      onClick={() => abrirEdicao(p)}
                      className="mr-3 text-xs text-[#C9A962] hover:underline"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => abrirModal(p)}
                      className="mr-3 text-xs text-[#C9A962] hover:underline"
                    >
                      Fotos
                    </button>
                    <button
                      onClick={() => handleStock(p.id, qty)}
                      className="mr-3 text-xs text-[#C9A962] hover:underline"
                    >
                      Stock
                    </button>
                    <button
                      onClick={() => toggleActive(p)}
                      className="mr-3 text-xs text-[#A3A3A3] hover:text-[#F5F5F5]"
                    >
                      {p.is_active ? "Desativar" : "Ativar"}
                    </button>
                    <button
                      onClick={() => pedirEliminar(p)}
                      className="text-xs text-red-300 hover:text-red-200"
                    >
                      Eliminar
                    </button>
                  </>
                );
              },
            },
          ]}
        />
      )}

      {/* ---------------- Histórico de movimentos da província ---------------- */}
      <section className="mt-8 rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
        <h2 className="mb-1 text-lg font-medium text-[#F5F5F5]">
          Movimentos de stock ·{" "}
          {provinciaStock
            ? (provincias.find((p) => p.id === provinciaStock)?.nome ?? "província")
            : "armazém-sede"}
        </h2>
        <p className="mb-4 text-xs text-[#6F6F6F]">
          Entradas, saídas e ajustes desta província, com responsável e data/hora.
        </p>

        {movimentos.length === 0 ? (
          <p className="text-sm text-[#8A8A8A]">Ainda não há movimentos nesta província.</p>
        ) : (
          <div className="tabela-deslizante">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-[#5A5A5A]">
                <tr>
                  <th className="py-2 pr-4 font-normal">Data</th>
                  <th className="py-2 pr-4 font-normal">Produto</th>
                  <th className="py-2 pr-4 font-normal">Tipo</th>
                  <th className="py-2 pr-4 text-right font-normal">Qtd.</th>
                  <th className="py-2 pr-4 text-right font-normal">Antes → depois</th>
                  <th className="py-2 font-normal">Nota</th>
                </tr>
              </thead>
              <tbody>
                {movimentos.map((m) => (
                  <tr key={m.id} className="border-t border-[#242424]">
                    <td className="py-2 pr-4 text-xs text-[#8A8A8A]">
                      {new Date(m.created_at).toLocaleString("pt-PT", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="py-2 pr-4 text-[#F5F5F5]">
                      {products.find((p) => p.id === m.product_id)?.name ?? "—"}
                    </td>
                    <td className="py-2 pr-4 text-[#A3A3A3]">
                      {TIPO_MOVIMENTO[m.type] ?? m.type}
                    </td>
                    <td className="py-2 pr-4 text-right text-[#A3A3A3]">{m.quantity}</td>
                    <td className="py-2 pr-4 text-right text-[#A3A3A3]">
                      {m.previous_quantity} → {m.new_quantity}
                    </td>
                    <td className="py-2 text-xs text-[#6F6F6F]">{m.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {/* ------------------------------------------------ eliminar produto */}
      {aEliminar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-[#4A2020] bg-[#141414]">
            <header className="flex items-center justify-between border-b border-[#262626] px-4 py-3">
              <h2 className="flex items-center gap-2 text-sm font-medium text-[#F5F5F5]">
                <AlertTriangle className="h-4 w-4 text-[#F87171]" />
                Eliminar produto
              </h2>
              <button
                onClick={() => setAEliminar(null)}
                aria-label="Fechar"
                className="text-[#8A8A8A] hover:text-[#F5F5F5]"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="p-4">
              <p className="mb-3 text-sm text-[#EDEDED]">
                «{aEliminar.produto.name}» vai sair do catálogo definitivamente.
              </p>

              <div className="mb-3 rounded-lg border border-[#262626] bg-[#0A0A0A] p-3 text-sm">
                <p className="mb-2 text-[11px] uppercase tracking-wide text-[#525252]">
                  Vai afectar
                </p>
                <ul className="space-y-1 text-[#C9C9C9]">
                  <LinhaImpacto n={aEliminar.impacto.order_items} singular="encomenda" plural="encomendas" />
                  <LinhaImpacto n={aEliminar.impacto.sale_items} singular="venda registada" plural="vendas registadas" />
                  <LinhaImpacto n={aEliminar.impacto.reservation_items} singular="reserva" plural="reservas" />
                  <LinhaImpacto n={aEliminar.impacto.discount_requests} singular="pedido de desconto" plural="pedidos de desconto" />
                  <LinhaImpacto n={aEliminar.impacto.favorites} singular="favorito" plural="favoritos" />
                  <LinhaImpacto n={aEliminar.impacto.images} singular="fotografia" plural="fotografias" />
                </ul>
              </div>

              {temHistorico ? (
                <>
                  <label className="mb-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-[#3A2020] bg-[#1A0F0F] p-3">
                    <input
                      type="checkbox"
                      checked={forcarHistorico}
                      onChange={(e) => setForcarHistorico(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[#DC2626]"
                    />
                    <span className="text-xs leading-relaxed text-[#C9C9C9]">
                      <strong className="block text-[#F5F5F5]">
                        Apagar também do histórico
                      </strong>
                      Para produtos fictícios, de demonstração ou de teste. Remove as linhas
                      deste produto nas encomendas, vendas e reservas
                      {(aEliminar.impacto.orders_emptied ??
                        0) + (aEliminar.impacto.sales_emptied ?? 0) + (aEliminar.impacto.reservations_emptied ?? 0) >
                      0 && (
                        <>
                          {" "}
                          e os registos que só têm este produto (
                          <strong className="text-[#F87171]">
                            {aEliminar.impacto.orders_emptied ?? 0} encomenda(s) ·{" "}
                            {aEliminar.impacto.sales_emptied ?? 0} venda(s) ·{" "}
                            {aEliminar.impacto.reservations_emptied ?? 0} reserva(s)
                          </strong>
                          )
                        </>
                      )}
                      . Os totais que sobrarem são recalculados.
                    </span>
                  </label>

                  <p className="mb-3 text-[11px] text-[#8A8A8A]">
                    Sem esta opção, as encomendas e vendas{" "}
                    <strong className="text-[#C9C9C9]">não são apagadas</strong>: ficam com o
                    nome e o preço deste produto, sem ligação ao catálogo.
                  </p>
                </>
              ) : (
                <p className="mb-3 text-[11px] text-[#8A8A8A]">
                  Este produto ainda não está em nenhuma encomenda ou venda. O stock e as
                  fotografias são removidos. Esta acção não se desfaz.
                </p>
              )}

              {forcarHistorico && (
                <p className="mb-3 rounded-lg border border-[#4A2020] bg-[#1A0F0F] px-3 py-2 text-[11px] font-medium text-[#F87171]">
                  O histórico deste produto desaparece por completo e não pode ser recuperado.
                </p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => confirmarEliminar(forcarHistorico)}
                  disabled={aApagar}
                  className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-50 ${
                    forcarHistorico
                      ? "bg-[#991B1B] hover:bg-[#DC2626]"
                      : "bg-[#DC2626] hover:bg-[#EF4444]"
                  }`}
                >
                  {aApagar
                    ? "A eliminar…"
                    : forcarHistorico
                      ? "Eliminar produto e histórico"
                      : "Sim, eliminar"}
                </button>
                <button
                  onClick={() => setAEliminar(null)}
                  disabled={aApagar}
                  className="rounded-lg border border-[#404040] px-4 py-2.5 text-sm text-[#A3A3A3] hover:text-[#F5F5F5]"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {alvo && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
          onClick={fecharModal}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-t-2xl border border-[#2A2A2A] bg-[#141414] sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-[#262626] px-4 py-3">
              <h2 className="truncate text-sm font-medium text-[#F5F5F5]">
                Fotos · {alvo.name}
              </h2>
              <button onClick={fecharModal} aria-label="Fechar" className="text-[#8A8A8A] hover:text-[#E5E5E5]">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="max-h-[70dvh] overflow-y-auto p-4">
              {/* ---- Fotografias que o produto já tem ---- */}
              {(alvo.images ?? []).length === 0 ? (
                <p className="mb-4 rounded-lg border border-[#2A2A2A] bg-[#0F0F0F] px-3 py-6 text-center text-xs text-[#8A8A8A]">
                  Ainda sem fotografias. Junte a primeira abaixo.
                </p>
              ) : (
                <div className="mb-4 grid grid-cols-3 gap-2">
                  {(alvo.images ?? []).map((img) => (
                    <div
                      key={img.id}
                      className={`relative overflow-hidden rounded-lg border bg-[#0A0A0A] ${
                        img.is_primary ? "border-[#C9A962]" : "border-[#333]"
                      }`}
                    >
                      <div className="aspect-square">
                        {img.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img.url} alt="" className="h-full w-full object-contain p-1" />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <ImagePlus className="h-5 w-5 text-[#3A3A3A]" />
                          </div>
                        )}
                      </div>
                      {img.is_primary && (
                        <span className="absolute left-1 top-1 rounded bg-[#C9A962] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#0A0A0A]">
                          capa
                        </span>
                      )}
                      <div className="flex items-center justify-between border-t border-[#262626] px-1 py-1">
                        {img.is_primary ? (
                          <span className="text-[10px] text-[#525252]">no catálogo</span>
                        ) : (
                          <button
                            onClick={() => capaDoAlvo(img)}
                            className="text-[10px] text-[#C9A962] hover:underline"
                          >
                            capa
                          </button>
                        )}
                        <button
                          onClick={() => removerFotoDoAlvo(img)}
                          aria-label="Apagar fotografia"
                          className="text-[#8A8A8A] hover:text-red-300"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ---- Acrescentar ---- */}
              <div className="rounded-lg border border-[#2A2A2A] bg-[#0F0F0F] p-3">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[#6F6F6F]">
                  Acrescentar
                </p>

                {alvoPreviews.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {alvoPreviews.map((src, i) => (
                      <div
                        key={src}
                        className="relative h-16 w-16 overflow-hidden rounded border border-[#333] bg-[#0A0A0A]"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt="" className="h-full w-full object-contain p-1" />
                        <button
                          onClick={() => {
                            URL.revokeObjectURL(src);
                            setAlvoPreviews((prev) => prev.filter((p) => p !== src));
                            setAlvoFicheiros((prev) => prev.filter((_, k) => k !== i));
                          }}
                          aria-label="Tirar"
                          className="absolute right-0.5 top-0.5 rounded-full bg-[#0A0A0A]/85 p-0.5 text-[#C9C9C9] hover:text-red-300"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <input
                  type="file"
                  accept="image/*"
                  multiple
                  id="fotos-produto"
                  hidden
                  onChange={(e) => escolherFicheiros(e, true)}
                />
                <button
                  type="button"
                  onClick={() => document.getElementById("fotos-produto")?.click()}
                  className="mb-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[#404040] px-3 py-2 text-sm text-[#E5E5E5] transition hover:border-[#C9A962] hover:text-[#C9A962]"
                >
                  <Upload className="h-4 w-4" />
                  {alvoFicheiros.length > 0 ? "Escolher mais" : "Carregar do computador"}
                </button>

                <input
                  value={alvoUrl}
                  onChange={(e) => setAlvoUrl(e.target.value)}
                  placeholder="…ou cole um URL (https://…)"
                  className={`w-full ${campo}`}
                />
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  onClick={guardarImagemDoAlvo}
                  disabled={
                    aGuardarImagem || (alvoFicheiros.length === 0 && !alvoUrl.trim())
                  }
                  className="flex-1 rounded-lg bg-[#C9A962] px-4 py-2.5 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-50"
                >
                  {aGuardarImagem ? "A guardar…" : "Acrescentar fotografias"}
                </button>
                <button
                  onClick={fecharModal}
                  className="rounded-lg border border-[#404040] px-4 py-2.5 text-sm text-[#A3A3A3] hover:text-[#F5F5F5]"
                >
                  Fechar
                </button>
              </div>

              <p className="mt-3 text-[11px] text-[#525252]">
                A capa é a fotografia que aparece no catálogo. Na página do produto deslizam-se
                todas as que existirem.
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/** Uma linha do impacto: só aparece quando há registos. */
function LinhaImpacto({
  n,
  singular,
  plural,
}: {
  n: number;
  singular: string;
  plural: string;
}) {
  if (!n) return null;
  return (
    <li className="flex justify-between gap-3">
      <span>{n === 1 ? singular : plural}</span>
      <span className="font-mono text-[#E3D5A7]">{n}</span>
    </li>
  );
}
