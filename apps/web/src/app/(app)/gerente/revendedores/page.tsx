import Link from "next/link";
import { redirect } from "next/navigation";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { listarProvincias } from "@/lib/provincias";
import GestaoRevendedores from "./GestaoRevendedores";

export const dynamic = "force-dynamic";

export interface ProvinciaOpcao {
  id: string;
  nome: string;
  codigo: string;
}

export interface CandidaturaRev {
  id: string;
  tipo: string;
  nome: string;
  telefone: string;
  email: string | null;
  nif: string | null;
  area_atuacao: string | null;
  representante: string | null;
  provincia_id: string | null;
  provincia: string | null;
  mensagem: string | null;
  resposta: string | null;
  status: string;
  created_at: string;
}

export interface RevendedorLinha {
  id: string;
  nome: string;
  tipo: string;
  telefone: string;
  email: string | null;
  provincia: string | null;
  desconto: number | null;
  minimo_unidades: number;
  status: string;
  nota: string | null;
}

export interface PedidoLinha {
  id: string;
  numero: string;
  status: string;
  total_unidades: number;
  valor_estimado: number;
  mensagem: string | null;
  resposta: string | null;
  created_at: string;
  revendedor: string | null;
  provincia: string | null;
}

/**
 * Uma linha do cadastro do catálogo de grosso.
 *
 * `no_catalogo` é a pergunta que interessa: o produto está à venda a grosso?
 * Um produto activo na loja pode não estar no grosso — são duas decisões
 * diferentes.
 */
export interface CatalogoProduto {
  product_id: string;
  nome: string;
  sku: string | null;
  categoria: string | null;
  imagem: string | null;
  preco_loja: number;
  no_catalogo: boolean;
  /** Preço de revenda escrito. `null` = produto pendente, ainda sem preço. */
  preco_proprio: number | null;
  /**
   * O preço que o revendedor paga — é o mesmo `preco_proprio`. `null` quando o
   * produto está no catálogo mas ainda não tem preço: fica pendente e não
   * aparece ao revendedor (0033).
   */
  preco_grosso: number | null;
  /** Diferença para o preço de loja. Informativa. */
  reducao: number;
  /** Diferença sobre o preço de compra, em percentagem. Informativa. */
  margem_pct: number;
  nota: string | null;
  stock: number | null;
}

export interface CatalogoGestao {
  minimo_produtos: number;
  /** Legado: a percentagem da 0026. O preço passou a vir da tabela. */
  desconto: number;
  /** As alavancas do grosso, em Kwanza. */
  reducoes: number[];
  margem_alvo: number;
  margem_max: number;
  totais: { produtos: number; no_catalogo: number; com_preco: number; pendentes: number };
  produtos: CatalogoProduto[];
}

interface CandidaturaBruta {
  id: string;
  tipo: string;
  nome: string;
  telefone: string;
  email: string | null;
  nif: string | null;
  area_atuacao: string | null;
  representante: string | null;
  provincia_id: string | null;
  mensagem: string | null;
  resposta: string | null;
  status: string;
  created_at: string;
  provincia: { nome: string } | null;
}

interface RevendedorBruto {
  id: string;
  nome: string;
  tipo: string;
  telefone: string;
  email: string | null;
  desconto: string | number | null;
  minimo_unidades: number;
  status: string;
  nota: string | null;
  provincia: { nome: string } | null;
}

interface PedidoBruto {
  id: string;
  numero: string;
  status: string;
  total_unidades: number;
  valor_estimado: string | number;
  mensagem: string | null;
  resposta: string | null;
  created_at: string;
  revendedor: { nome: string } | null;
  provincia: { nome: string } | null;
}

/**
 * Revendedores (grosso).
 *
 * Junta três coisas que antes viviam separadas: quem se candidatou, quem já
 * compra ao grosso e o que está pendente de resposta. A gestão provincial vê
 * a sua província; a administração nacional vê o país — o RLS trata disso, a
 * página não repete a regra.
 */
export default async function RevendedoresPage() {
  const profile = await getProfile();
  if (!profile || profile.role !== "manager") redirect("/");

  const supabase = await createClientServer();

  const [provincias, candidaturasRes, revendedoresRes, pedidosRes, produtosRes, catalogoRes, configRes] =
    await Promise.all([
      listarProvincias(supabase),
      supabase
        .from("revendedor_candidaturas")
        .select(
          "id, tipo, nome, telefone, email, nif, area_atuacao, representante, provincia_id, mensagem, resposta, status, created_at, provincia:provincias(nome)"
        )
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("revendedores")
        .select(
          "id, nome, tipo, telefone, email, desconto, minimo_unidades, status, nota, provincia:provincias(nome)"
        )
        .order("created_at", { ascending: false })
        .limit(300),
      supabase
        .from("revendedor_pedidos")
        .select(
          "id, numero, status, total_unidades, valor_estimado, mensagem, resposta, created_at, revendedor:revendedores(nome), provincia:provincias(nome)"
        )
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("products")
        .select("id, name, sku, official_price")
        .eq("is_active", true)
        .order("name"),
      // O cadastro do grosso vem inteiro da base (0031): preço de loja, preço
      // de grosso a valer, e se o produto está inscrito. Uma chamada, uma
      // verdade — a página não recalcula descontos.
      supabase.rpc("catalogo_revenda_gestao"),
      supabase
        .from("platform_settings")
        .select("value")
        .eq("key", "revenda_desconto")
        .maybeSingle(),
    ]);

  const emFalta = [
    candidaturasRes.error?.message,
    revendedoresRes.error?.message,
  ].some((m) => /PGRST205|PGRST202|PGRST204|42703|does not exist/i.test(m ?? ""));

  const candidaturas: CandidaturaRev[] = ((candidaturasRes.data ?? []) as unknown as CandidaturaBruta[]).map(
    (c) => ({
      id: c.id,
      tipo: c.tipo,
      nome: c.nome,
      telefone: c.telefone,
      email: c.email,
      nif: c.nif,
      area_atuacao: c.area_atuacao,
      representante: c.representante,
      provincia_id: c.provincia_id,
      provincia: c.provincia?.nome ?? null,
      mensagem: c.mensagem,
      resposta: c.resposta,
      status: c.status,
      created_at: c.created_at,
    })
  );

  const revendedores: RevendedorLinha[] = ((revendedoresRes.data ?? []) as unknown as RevendedorBruto[]).map(
    (r) => ({
      id: r.id,
      nome: r.nome,
      tipo: r.tipo,
      telefone: r.telefone,
      email: r.email,
      provincia: r.provincia?.nome ?? null,
      desconto: r.desconto === null ? null : Number(r.desconto),
      minimo_unidades: r.minimo_unidades,
      status: r.status,
      nota: r.nota,
    })
  );

  const pedidos: PedidoLinha[] = ((pedidosRes.data ?? []) as unknown as PedidoBruto[]).map((p) => ({
    id: p.id,
    numero: p.numero,
    status: p.status,
    total_unidades: p.total_unidades,
    valor_estimado: Number(p.valor_estimado),
    mensagem: p.mensagem,
    resposta: p.resposta,
    created_at: p.created_at,
    revendedor: p.revendedor?.nome ?? null,
    provincia: p.provincia?.nome ?? null,
  }));

  const config = configRes.data as { value?: { value?: number } } | null;
  const descontoEmpresa =
    typeof config?.value?.value === "number" ? config.value.value : 0.35;

  /**
   * O cadastro do catálogo de grosso.
   *
   * Antes da 0031 não existe `catalogo_revenda_gestao()`. Nesse caso monta-se
   * a mesma lista a partir dos produtos activos, com tudo «no catálogo» — que
   * é exactamente como o grosso funcionava antes. O ecrã avisa que falta o
   * patch em vez de ficar vazio, e as acções de inscrever/retirar ficam
   * desligadas (a base recusaria).
   */
  const semCatalogo =
    !!catalogoRes.error && /PGRST202|PGRST205|does not exist/i.test(catalogoRes.error.message);

  let catalogo: CatalogoGestao;

  if (!semCatalogo && catalogoRes.data) {
    const bruto = catalogoRes.data as Record<string, unknown>;
    const totais = (bruto.totais ?? {}) as Record<string, unknown>;
    const lista = (bruto.produtos ?? []) as Record<string, unknown>[];

    catalogo = {
      minimo_produtos: Number(bruto.minimo_produtos) || 4,
      desconto: Number(bruto.desconto) || descontoEmpresa,
      reducoes: Array.isArray(bruto.reducoes)
        ? (bruto.reducoes as unknown[]).map(Number).filter((n) => n > 0)
        : [3500, 4000, 5000],
      margem_alvo: Number(bruto.margem_alvo) || 0.2,
      margem_max: Number(bruto.margem_max) || 0.3,
      totais: {
        produtos: Number(totais.produtos) || 0,
        no_catalogo: Number(totais.no_catalogo) || 0,
        com_preco: Number(totais.com_preco) || 0,
        pendentes: Number(totais.pendentes) || 0,
      },
      produtos: lista.map((p) => ({
        product_id: String(p.product_id),
        nome: String(p.nome ?? ""),
        sku: (p.sku as string | null) ?? null,
        categoria: (p.categoria as string | null) ?? null,
        imagem: (p.imagem as string | null) ?? null,
        preco_loja: Number(p.preco_loja) || 0,
        no_catalogo: p.no_catalogo === true,
        preco_proprio:
          p.preco_proprio === null || p.preco_proprio === undefined
            ? null
            : Number(p.preco_proprio),
        preco_grosso:
          p.preco_grosso === null || p.preco_grosso === undefined
            ? null
            : Number(p.preco_grosso),
        reducao: Number(p.reducao) || 0,
        margem_pct: Number(p.margem_pct) || 0,
        nota: (p.nota as string | null) ?? null,
        stock: p.stock === null || p.stock === undefined ? null : Number(p.stock),
      })),
    };
  } else {
    const linhas = (produtosRes.data ?? []) as {
      id: string;
      name: string;
      sku: string | null;
      official_price: string | number;
    }[];

    catalogo = {
      minimo_produtos: 1,
      desconto: descontoEmpresa,
      reducoes: [3500, 4000, 5000],
      margem_alvo: 0.2,
      margem_max: 0.3,
      totais: {
        produtos: linhas.length,
        no_catalogo: linhas.length,
        com_preco: 0,
        pendentes: linhas.length,
      },
      produtos: linhas.map((p) => {
        const loja = Number(p.official_price);
        return {
          product_id: p.id,
          nome: p.name,
          sku: p.sku,
          categoria: null,
          imagem: null,
          preco_loja: loja,
          no_catalogo: true,
          preco_proprio: null,
          // Sem 0032 não há tabela: fica o desconto da empresa, que é o que a
          // base antiga aplicava. É uma pré-visualização, não uma promessa.
          preco_grosso: Math.round(loja * (1 - descontoEmpresa) * 100) / 100,
          reducao: Math.round(loja * descontoEmpresa * 100) / 100,
          margem_pct: 0,
          nota: null,
          stock: null,
        };
      }),
    };
  }

  const novas = candidaturas.filter((c) => c.status === "novo");
  const pendentes = pedidos.filter((p) =>
    ["novo", "em_analise", "cotado", "aprovado"].includes(p.status)
  );
  const activos = revendedores.filter((r) => r.status === "activo");

  const provinciaFixa =
    profile.is_national_admin || profile.provincia_id === null ? null : profile.provincia_id;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <Link href="/gerente" className="mb-6 inline-block text-sm text-[#A3A3A3] hover:text-[#C9A962]">
        ← Painel de gestão
      </Link>

      <header className="mb-6">
        <p className="text-[10px] uppercase tracking-[0.22em] text-[#C9A962]">
          INUKA Angola · grosso e revenda
        </p>
        <h1 className="mt-2 text-3xl font-light text-[#F5F5F5]">Revendedores</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#A3A3A3]">
          Candidaturas do site, contas aprovadas e pedidos de grosso. Aprovar cria a conta e a
          ficha; a partir daí o revendedor compra sozinho ao preço de grosso.
        </p>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Indicador rotulo="Por contactar" valor={String(novas.length)} destaque={novas.length > 0} />
        <Indicador rotulo="Revendedores activos" valor={String(activos.length)} />
        <Indicador rotulo="Pedidos em curso" valor={String(pendentes.length)} />
        <Indicador
          rotulo="Valor em curso"
          valor={new Intl.NumberFormat("pt-AO", {
            style: "currency",
            currency: "AOA",
            maximumFractionDigits: 0,
          }).format(pendentes.reduce((soma, p) => soma + p.valor_estimado, 0))}
        />
      </div>

      {emFalta && (
        <div className="mb-6 rounded-xl border border-[#C9A962]/40 bg-[#C9A962]/10 p-4 text-sm text-[#E3D5A7]">
          Falta aplicar a migração 0026/0027 — cole <code>supabase/PATCH_REVENDEDORES.sql</code> e
          depois <code>supabase/PATCH_CANDIDATURAS_DETALHE.sql</code> no SQL Editor do Supabase. Até
          lá esta página fica vazia.
        </div>
      )}

      <GestaoRevendedores
        candidaturas={candidaturas}
        revendedores={revendedores}
        pedidos={pedidos}
        catalogo={catalogo}
        semCatalogo={semCatalogo}
        provincias={provincias.map((p) => ({ id: p.id, nome: p.nome, codigo: p.codigo }))}
        provinciaFixa={provinciaFixa}
      />
    </main>
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
