"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { ImagePlus, Package, Plus, Upload, X } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { setProductStock } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
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
}

interface LinhaStock {
  quantity: number;
  provincia_id: string | null;
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
 * Guarda a imagem de um produto.
 *
 * Duas proveniências, uma só coluna lida pelo site (`product_images.url`):
 *  - ficheiro → Storage `product-images/<produtoId>/<uuid>.<ext>`; o bucket é
 *    público, por isso o URL público serve directamente e não precisa de
 *    assinatura.
 *  - URL colado pela gerência → fica tal e qual. `storage_path` é NOT NULL, por
 *    isso guarda o próprio URL; nada no site o usa para renderizar.
 *
 * A imagem anterior é substituída (o catálogo mostra uma por produto).
 */
async function guardarImagem(
  productId: string,
  ficheiro: File | null,
  urlExterna: string
): Promise<string> {
  const supabase = createClientBrowser();

  let url = urlExterna.trim();
  let caminho = url;

  if (ficheiro) {
    if (!ficheiro.type.startsWith("image/")) throw new Error("O ficheiro não é uma imagem.");
    if (ficheiro.size > MAX_BYTES) throw new Error("A imagem passa dos 5 MB.");

    const ext = extensao(ficheiro.name, ficheiro.type);
    caminho = `${productId}/${crypto.randomUUID()}.${ext}`;

    const up = await supabase.storage.from(BUCKET).upload(caminho, ficheiro, {
      contentType: ficheiro.type,
      upsert: false,
    });
    if (up.error) throw new Error(up.error.message);

    url = supabase.storage.from(BUCKET).getPublicUrl(caminho).data.publicUrl;
  }

  if (!url) throw new Error("Escolha um ficheiro ou cole um URL.");

  // Substituir: apagar as linhas antigas e os ficheiros que vivem no bucket.
  const { data: antigas } = await supabase
    .from("product_images")
    .select("id, storage_path")
    .eq("product_id", productId);

  if (antigas && antigas.length > 0) {
    const noBucket = antigas
      .map((a) => (a as { storage_path: string }).storage_path)
      .filter((p) => p && !/^https?:\/\//i.test(p));
    if (noBucket.length > 0) await supabase.storage.from(BUCKET).remove(noBucket);
    await supabase.from("product_images").delete().eq("product_id", productId);
  }

  const { error } = await supabase.from("product_images").insert({
    product_id: productId,
    storage_path: caminho,
    url,
    is_primary: true,
    sort_order: 0,
  });
  if (error) throw new Error(error.message);

  return url;
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

  const [ficheiro, setFicheiro] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const inputFicheiro = useRef<HTMLInputElement>(null);

  // Modal de imagem de um produto já existente
  const [alvo, setAlvo] = useState<ProductRow | null>(null);
  const [alvoFicheiro, setAlvoFicheiro] = useState<File | null>(null);
  const [alvoUrl, setAlvoUrl] = useState("");
  const [alvoPreview, setAlvoPreview] = useState("");
  const [aGuardarImagem, setAGuardarImagem] = useState(false);

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

  function escolherFicheiro(e: ChangeEvent<HTMLInputElement>, paraModal: boolean) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;

    if (!f.type.startsWith("image/")) {
      setError("Escolha um ficheiro de imagem.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setError("A imagem passa dos 5 MB.");
      return;
    }

    setError("");
    if (paraModal) {
      setAlvoFicheiro(f);
      setAlvoPreview(URL.createObjectURL(f));
    } else {
      setFicheiro(f);
      setPreview(URL.createObjectURL(f));
    }
  }

  function limparImagem(paraModal: boolean) {
    if (paraModal) {
      if (alvoPreview) URL.revokeObjectURL(alvoPreview);
      setAlvoFicheiro(null);
      setAlvoPreview("");
      setAlvoUrl("");
    } else {
      if (preview) URL.revokeObjectURL(preview);
      setFicheiro(null);
      setPreview("");
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
      if (ficheiro || form.imagemUrl.trim()) {
        try {
          await guardarImagem(editando.id, ficheiro, form.imagemUrl);
        } catch (err) {
          avisos.push(`a imagem falhou: ${err instanceof Error ? err.message : "erro"}`);
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

    // Imagem primeiro: é o que o utilizador pediu para ficar guardado.
    if (ficheiro || form.imagemUrl.trim()) {
      try {
        await guardarImagem(productId, ficheiro, form.imagemUrl);
      } catch (err) {
        avisos.push(
          `produto criado, mas a imagem falhou: ${err instanceof Error ? err.message : "erro"}`
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

  // Tabelas que apontam para o produto sem ON DELETE CASCADE: se houver
  // história, o DELETE rebenta na FK. Nesse caso o correcto é desactivar.
  async function eliminar(p: ProductRow) {
    setError("");
    setNotice("");

    const supabase = createClientBrowser();
    const contar = (tabela: string) =>
      supabase
        .from(tabela)
        .select("id", { count: "exact", head: true })
        .eq("product_id", p.id)
        .then(({ count }) => count ?? 0);

    const [vendas, encomendas, reservas, descontos] = await Promise.all([
      contar("sale_items"),
      contar("order_items"),
      contar("reservation_items"),
      contar("discount_requests"),
    ]);
    const usos = vendas + encomendas + reservas + descontos;

    if (usos > 0) {
      setError(
        `«${p.name}» já aparece em ${usos} registo(s) de vendas, encomendas, reservas ou descontos. ` +
          "Eliminar apagaria esse histórico — use «Desativar» para o tirar da loja sem perder nada."
      );
      return;
    }

    const resposta = window.confirm(
      `Eliminar «${p.name}» definitivamente?\n\nSão apagados também o stock, as imagens e o histórico de movimentos deste produto. Esta acção não se desfaz.`
    );
    if (!resposta) return;

    // Primeiro os ficheiros do Storage: se o DELETE do produto passar e a
    // remoção do ficheiro falhar, ficam órfãos sem forma de os encontrar.
    const caminhos = (p.images ?? []).map((i) => i.storage_path).filter(Boolean);
    if (caminhos.length > 0) {
      await supabase.storage.from(BUCKET).remove(caminhos);
    }

    const { error: delErr } = await supabase.from("products").delete().eq("id", p.id);
    if (delErr) {
      setError(
        delErr.code === "23503"
          ? `«${p.name}» ainda está referenciado noutro sítio. Desactive-o em vez de eliminar.`
          : delErr.message
      );
      return;
    }

    if (editando?.id === p.id) fecharFormulario();
    setNotice(`«${p.name}» eliminado.`);
    await load();
  }

  async function guardarImagemDoAlvo() {
    if (!alvo) return;
    setAGuardarImagem(true);
    setError("");
    try {
      await guardarImagem(alvo.id, alvoFicheiro, alvoUrl);
      setNotice("Imagem guardada.");
      setAlvo(null);
      limparImagem(true);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar a imagem.");
    } finally {
      setAGuardarImagem(false);
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
    setAlvoFicheiro(null);
    setAlvoUrl("");
    setAlvoPreview(imagemPrincipal(p) ?? "");
    setError("");
  }

  function fecharModal() {
    setAlvo(null);
    if (alvoFicheiro) URL.revokeObjectURL(alvoPreview);
    setAlvoFicheiro(null);
    setAlvoUrl("");
    setAlvoPreview("");
  }

  const campo =
    "rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none";

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

          {/* ---------------- Imagem do produto ---------------- */}
          <div className="mt-4 rounded-lg border border-[#2A2A2A] bg-[#141414] p-4">
            <p className="mb-3 text-sm font-medium text-[#E5E5E5]">Imagem do produto</p>
            <div className="flex flex-wrap items-start gap-4">
              <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#333] bg-[#0A0A0A]">
                {preview || form.imagemUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={preview || form.imagemUrl}
                    alt="Pré-visualização"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ImagePlus className="h-7 w-7 text-[#3A3A3A]" />
                )}
              </div>

              <div className="min-w-[220px] flex-1 space-y-2">
                <input
                  ref={inputFicheiro}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => escolherFicheiro(e, false)}
                />
                <button
                  type="button"
                  onClick={() => inputFicheiro.current?.click()}
                  className="inline-flex items-center gap-2 rounded-lg border border-[#404040] px-3 py-2 text-sm text-[#E5E5E5] transition hover:border-[#C9A962] hover:text-[#C9A962]"
                >
                  <Upload className="h-4 w-4" />
                  {ficheiro ? "Trocar ficheiro" : "Carregar do computador"}
                </button>
                {ficheiro && (
                  <p className="text-[11px] text-[#8A8A8A]">
                    {ficheiro.name} · {(ficheiro.size / 1024).toFixed(0)} KB
                  </p>
                )}

                <input
                  value={form.imagemUrl}
                  onChange={(e) => {
                    setForm({ ...form, imagemUrl: e.target.value });
                    if (ficheiro) limparImagem(false);
                  }}
                  placeholder="…ou cole um URL (https://…)"
                  className={`w-full ${campo}`}
                />
                {(ficheiro || form.imagemUrl) && (
                  <button
                    type="button"
                    onClick={() => limparImagem(false)}
                    className="text-[11px] text-[#8A8A8A] underline hover:text-[#E5E5E5]"
                  >
                    remover imagem
                  </button>
                )}
              </div>
            </div>
            <p className="mt-3 text-[11px] text-[#525252]">
              Ficheiro até 5 MB (JPG, PNG, WebP). O ficheiro fica no Storage; o URL serve para
              usar uma imagem que já esteja alojada.
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
                        Imagem
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
                        onClick={() => eliminar(p)}
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
                      Imagem
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
                      onClick={() => eliminar(p)}
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
              <h2 className="text-sm font-medium text-[#F5F5F5]">Imagem · {alvo.name}</h2>
              <button onClick={fecharModal} aria-label="Fechar" className="text-[#8A8A8A] hover:text-[#E5E5E5]">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="p-4">
              <div className="mb-3 flex h-40 items-center justify-center overflow-hidden rounded-lg border border-[#333] bg-[#0A0A0A]">
                {alvoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={alvoPreview} alt="" className="h-full w-full object-contain" />
                ) : (
                  <ImagePlus className="h-8 w-8 text-[#3A3A3A]" />
                )}
              </div>

              <input
                type="file"
                accept="image/*"
                id="imagem-produto"
                hidden
                onChange={(e) => escolherFicheiro(e, true)}
              />
              <button
                type="button"
                onClick={() => document.getElementById("imagem-produto")?.click()}
                className="mb-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[#404040] px-3 py-2 text-sm text-[#E5E5E5] transition hover:border-[#C9A962] hover:text-[#C9A962]"
              >
                <Upload className="h-4 w-4" />
                {alvoFicheiro ? "Trocar ficheiro" : "Carregar do computador"}
              </button>

              <input
                value={alvoUrl}
                onChange={(e) => {
                  setAlvoUrl(e.target.value);
                  setAlvoFicheiro(null);
                  setAlvoPreview(e.target.value);
                }}
                placeholder="…ou cole um URL (https://…)"
                className={`w-full ${campo}`}
              />

              <div className="mt-4 flex gap-2">
                <button
                  onClick={guardarImagemDoAlvo}
                  disabled={aGuardarImagem || (!alvoFicheiro && !alvoUrl.trim())}
                  className="flex-1 rounded-lg bg-[#C9A962] px-4 py-2.5 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-50"
                >
                  {aGuardarImagem ? "A guardar…" : "Guardar imagem"}
                </button>
                <button
                  onClick={fecharModal}
                  className="rounded-lg border border-[#404040] px-4 py-2.5 text-sm text-[#A3A3A3] hover:text-[#F5F5F5]"
                >
                  Cancelar
                </button>
              </div>

              <p className="mt-3 text-[11px] text-[#525252]">
                Guardar substitui a imagem actual do produto.
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
