/**
 * Perfis e competências — a única definição na interface.
 *
 * O que está aqui é a **descrição** das permissões. Quem manda é a base de
 * dados (migração 0013): as políticas RLS e os RPC recusam a operação mesmo
 * que a interface se engane. Esta tabela serve para a navegação, para os
 * textos de ajuda e para a página de gestão de perfis.
 *
 * Regra de ouro: um perfil só vê o que lhe compete. Se uma área não estiver
 * na lista de `areas` do papel, ela não aparece no menu — e o `proxy.ts`
 * redirecciona quem tente entrar pelo URL.
 */

import type { UserRole } from "@/types";

export type Papel = Exclude<UserRole, "visitor">;

export interface Perfil {
  papel: Papel;
  etiqueta: string;
  /** Uma linha que explica o que a pessoa faz. */
  missao: string;
  /** Área principal, para onde o login a leva. */
  area: string;
  /** Cor de destaque na matriz de perfis. */
  cor: string;
  /** Regalias e limites — o que ganha e o que não lhe pertence. */
  regalias: string[];
  limites: string[];
}

export const PERFIS: Perfil[] = [
  {
    papel: "manager",
    etiqueta: "Gestor",
    missao: "Responde pela operação inteira: catálogo, preços, equipa e resultados.",
    area: "/gerente",
    cor: "#C9A962",
    regalias: [
      "Acesso total a todas as áreas, incluindo definições e designer",
      "Vê todas as províncias e todos os colaboradores",
      "Cria, promove e desactiva contas de colaborador e de vendedor de loja",
      "Publica no Feed Inuka (equipa) e no Feed Clientes (promoções e testemunhos)",
    ],
    limites: [
      "As alterações de preço e de taxa de comissão ficam registadas na auditoria",
      "Não pode apagar o histórico de uma venda concluída",
    ],
  },
  {
    papel: "seller",
    etiqueta: "Colaborador de vendas",
    missao: "Vende por carteira: angaria clientes e acompanha as compras deles.",
    area: "/vendedor",
    cor: "#7BA7D9",
    regalias: [
      "Carteira de clientes própria, com vendas e reservas",
      "Comissão sobre as vendas que regista (taxa pessoal ou da empresa)",
      "Formação INUKA e comunicados internos",
      "Registo de vendas a clientes sem conta, pelo telefone",
    ],
    limites: [
      "Não altera stock nem preços",
      "Não vê a carteira de outro colaborador",
      "Não publica conteúdos",
    ],
  },
  {
    papel: "store_seller",
    etiqueta: "Vendedor de loja",
    missao: "Tem a loja a funcionar: stock contado, balcão atendido e encomendas prontas.",
    area: "/loja",
    cor: "#5FBF8F",
    regalias: [
      "Gestão de stock da sua província, com histórico de movimentos",
      "Venda ao balcão com baixa imediata de stock",
      "Vê e prepara as encomendas para levantamento ou entrega",
      "Vê reservas ativas para não vender stock reservado",
    ],
    limites: [
      "Não cria nem elimina produtos — só a gestão",
      "Não tem carteira de clientes nem comissões",
      "Não altera preços, conteúdos ou definições",
    ],
  },
  {
    papel: "customer",
    etiqueta: "Cliente",
    missao: "Compra, reserva e acompanha tudo o que é seu.",
    area: "/cliente",
    cor: "#E0E0E0",
    regalias: [
      "Preço de loja e promoções publicadas",
      "Reservas com prazo quando um artigo está esgotado",
      "Favoritos, histórico de compras e o Feed Clientes (promoções e testemunhos)",
      "Conversa privada com a gestão — nunca num grupo",
    ],
    limites: [
      "Não vê stock interno nem dados de outros clientes",
      "Não entra em grupos da equipa",
      "Só cancela ou confirma a recepção da própria encomenda",
    ],
  },
];

export function perfilDe(papel: string | null | undefined): Perfil | null {
  return PERFIS.find((p) => p.papel === papel) ?? null;
}

export function rotuloPapel(papel: string | null | undefined): string {
  return perfilDe(papel)?.etiqueta ?? "Visitante";
}

export function areaDoPapel(papel: string | null | undefined): string {
  return perfilDe(papel)?.area ?? "/";
}

/** Áreas privadas de cada papel. Usado pelo proxy e pelo menu. */
export const AREAS: Record<Papel, string[]> = {
  manager: ["/gerente", "/designer", "/vendedor", "/loja", "/cliente"],
  seller: ["/vendedor"],
  store_seller: ["/loja"],
  customer: ["/cliente"],
};

/** Uma competência por linha da matriz. */
export type Competencia =
  | "catalogo"
  | "comprar"
  | "reservar"
  | "favoritos"
  | "feed_ver"
  | "feed_publicar"
  | "encomendas_proprias"
  | "encomendas_loja"
  | "stock"
  | "vendas_balcao"
  | "carteira"
  | "vendas_comissao"
  | "produtos"
  | "colaboradores"
  | "conteudos"
  | "formacao"
  | "relatorios"
  | "definicoes"
  | "conversa_privada"
  | "grupos_equipa";

interface LinhaMatriz {
  competencia: Competencia;
  rotulo: string;
  descricao: string;
  /** Papéis com a competência. */
  quem: Papel[];
}

export const MATRIZ: LinhaMatriz[] = [
  {
    competencia: "catalogo",
    rotulo: "Ver catálogo",
    descricao: "Produtos ativos da província e os nacionais.",
    quem: ["manager", "seller", "store_seller", "customer"],
  },
  {
    competencia: "comprar",
    rotulo: "Comprar",
    descricao: "Carrinho, encomenda e pagamento.",
    quem: ["manager", "seller", "store_seller", "customer"],
  },
  {
    competencia: "reservar",
    rotulo: "Reservar esgotados",
    descricao: "Guarda stock por 48 h quando o artigo está esgotado.",
    quem: ["manager", "customer"],
  },
  {
    competencia: "favoritos",
    rotulo: "Favoritos",
    descricao: "Lista pessoal de produtos preferidos.",
    quem: ["manager", "customer"],
  },
  {
    competencia: "feed_ver",
    rotulo: "Feed Inuka e Feed Clientes",
    descricao:
      "Comunicados e formação só para a equipa; promoções e testemunhos para os clientes.",
    quem: ["manager", "seller", "store_seller", "customer"],
  },
  {
    competencia: "feed_publicar",
    rotulo: "Publicar no feed",
    descricao: "Criar e agendar comunicados, promoções e testemunhos.",
    quem: ["manager"],
  },
  {
    competencia: "encomendas_proprias",
    rotulo: "As suas encomendas",
    descricao: "Acompanhar e confirmar a recepção do que comprou.",
    quem: ["manager", "seller", "store_seller", "customer"],
  },
  {
    competencia: "encomendas_loja",
    rotulo: "Preparar encomendas",
    descricao: "Confirmar, preparar e entregar encomendas de clientes.",
    quem: ["manager", "store_seller"],
  },
  {
    competencia: "stock",
    rotulo: "Gerir stock",
    descricao: "Contagens, entradas e saídas da província.",
    quem: ["manager", "store_seller"],
  },
  {
    competencia: "vendas_balcao",
    rotulo: "Vender ao balcão",
    descricao: "Venda presencial com baixa imediata de stock.",
    quem: ["manager", "store_seller"],
  },
  {
    competencia: "carteira",
    rotulo: "Carteira de clientes",
    descricao: "Clientes atribuídos, reservas e histórico de compras.",
    quem: ["manager", "seller"],
  },
  {
    competencia: "vendas_comissao",
    rotulo: "Vendas com comissão",
    descricao: "Registar vendas em nome de um cliente e gerar comissão.",
    quem: ["manager", "seller"],
  },
  {
    competencia: "produtos",
    rotulo: "Gerir produtos",
    descricao: "Criar, editar, fotografar e eliminar artigos.",
    quem: ["manager"],
  },
  {
    competencia: "colaboradores",
    rotulo: "Gerir equipa",
    descricao: "Criar contas, atribuir províncias e taxas.",
    quem: ["manager"],
  },
  {
    competencia: "conteudos",
    rotulo: "Gerir conteúdos",
    descricao: "Comunicados, testemunhos, promoções e formação.",
    quem: ["manager"],
  },
  {
    competencia: "formacao",
    rotulo: "Formação",
    descricao: "Cursos, aulas e progresso.",
    quem: ["manager", "seller"],
  },
  {
    competencia: "relatorios",
    rotulo: "Relatórios",
    descricao: "Vendas, stock e desempenho da operação.",
    quem: ["manager"],
  },
  {
    competencia: "definicoes",
    rotulo: "Definições",
    descricao: "Taxas, prazos e parâmetros da plataforma.",
    quem: ["manager"],
  },
  {
    competencia: "conversa_privada",
    rotulo: "Conversa privada",
    descricao: "Cliente fala directamente com a gestão.",
    quem: ["manager", "seller", "store_seller", "customer"],
  },
  {
    competencia: "grupos_equipa",
    rotulo: "Grupos da equipa",
    descricao: "Grupos só de colaboradores e gestão, geridos pela gestão.",
    quem: ["manager", "seller", "store_seller"],
  },
];

export function temCompetencia(papel: string | null | undefined, c: Competencia): boolean {
  const linha = MATRIZ.find((m) => m.competencia === c);
  if (!linha) return false;
  return linha.quem.includes(papel as Papel);
}
