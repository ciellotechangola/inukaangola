import {
  FUNDO_PADRAO,
  novoId,
  type DesignPage,
  type DesignTemplate,
  type PageBackground,
  type ShapeKind,
  type TextElement,
} from "./types";

/**
 * Modelos prontos.
 *
 * São dados puros com ids fixos — se fossem gerados com `randomUUID()` o HTML
 * do servidor e o do cliente divergiam na hidratação. Ao aplicar um modelo,
 * `instanciarTemplate` recria todos os ids.
 *
 * Não há preços nem stock inventados: os textos remetem para o catálogo.
 */

type Seed = Omit<DesignTemplate, "id"> & { id: string };

const OURO = "#C9A962";
const OURO_CLARO = "#E3D5A7";
const BRANCO = "#F5F5F5";
const CINZA = "#A3A3A3";
const PRETO = "#0A0A0A";

function fundo(color: string): PageBackground {
  return { ...FUNDO_PADRAO, type: "solid", color };
}

function gradiente(from: string, to: string, angle = 160): PageBackground {
  return { ...FUNDO_PADRAO, type: "gradient", from, to, angle };
}

let contador = 0;

function t(
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  over: Partial<TextElement> = {}
): TextElement {
  contador += 1;
  return {
    id: `seed-txt-${contador}`,
    type: "text",
    name: "Texto",
    x,
    y,
    w,
    h,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    text,
    fontFamily: "Inter",
    fontSize: 48,
    fontWeight: 700,
    italic: false,
    underline: false,
    uppercase: false,
    color: BRANCO,
    align: "left",
    lineHeight: 1.2,
    letterSpacing: 0,
    ...over,
  };
}

function forma(
  shape: ShapeKind,
  x: number,
  y: number,
  w: number,
  h: number,
  over: Partial<Extract<DesignPage["elements"][number], { type: "shape" }>> = {}
): Extract<DesignPage["elements"][number], { type: "shape" }> {
  contador += 1;
  return {
    id: `seed-shp-${contador}`,
    type: "shape",
    name: shape,
    x,
    y,
    w,
    h,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    shape,
    fill: OURO,
    stroke: "transparent",
    strokeWidth: 0,
    radius: 0,
    ...over,
  };
}

function icone(
  name: string,
  x: number,
  y: number,
  size: number,
  color = OURO
): Extract<DesignPage["elements"][number], { type: "icon" }> {
  contador += 1;
  return {
    id: `seed-ico-${contador}`,
    type: "icon",
    name,
    x,
    y,
    w: size,
    h: size,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    color,
    strokeWidth: 1.6,
  };
}

function pagina(nome: string, background: PageBackground, elements: DesignPage["elements"]): DesignPage {
  contador += 1;
  return { id: `seed-pag-${contador}`, name: nome, background, elements };
}

// ---------------------------------------------------------------------------

const promocao = pagina("Promoção", gradiente("#0A0A0A", "#241E10", 150), [
  forma("rect", 48, 48, 984, 984, {
    fill: "transparent",
    stroke: "rgba(201,169,98,0.45)",
    strokeWidth: 2,
    radius: 8,
  }),
  icone("sparkles", 92, 96, 56),
  t(92, 176, 500, 44, "INUKA", {
    fontSize: 34,
    fontWeight: 600,
    letterSpacing: 14,
    color: OURO,
    uppercase: true,
  }),
  t(92, 330, 860, 300, "Nova\ncoleção", {
    fontSize: 150,
    fontWeight: 700,
    lineHeight: 0.95,
  }),
  forma("line", 96, 690, 180, 4, { fill: OURO }),
  t(92, 740, 760, 120, "Exclusive · Signature · Modern Me", {
    fontSize: 40,
    fontWeight: 400,
    color: OURO_CLARO,
  }),
  t(92, 890, 860, 60, "Consulte o preço e a disponibilidade no catálogo", {
    fontSize: 28,
    fontWeight: 400,
    color: CINZA,
  }),
]);

const produto = pagina("Produto", fundo(PRETO), [
  forma("ellipse", 240, 120, 600, 600, {
    fill: "rgba(201,169,98,0.12)",
    stroke: OURO,
    strokeWidth: 3,
  }),
  icone("crown", 480, 360, 120, OURO_CLARO),
  t(90, 760, 900, 120, "Nome do produto", {
    fontSize: 84,
    fontWeight: 700,
    align: "center",
  }),
  t(90, 880, 900, 60, "Descrição curta do produto", {
    fontSize: 36,
    fontWeight: 400,
    color: CINZA,
    align: "center",
  }),
  forma("rect", 390, 970, 300, 68, { fill: OURO, radius: 34 }),
  t(390, 988, 300, 40, "Ver no catálogo", {
    fontSize: 26,
    fontWeight: 600,
    color: PRETO,
    align: "center",
  }),
]);

const story = pagina("Story", gradiente("#120F08", "#0A0A0A", 200), [
  forma("rect", 0, 0, 1080, 1920, { fill: "transparent", stroke: "transparent" }),
  icone("badge-percent", 460, 260, 160, OURO),
  t(80, 520, 920, 320, "PROMOÇÃO\nDA SEMANA", {
    fontSize: 130,
    fontWeight: 700,
    align: "center",
    lineHeight: 1,
  }),
  forma("line", 440, 900, 200, 4, { fill: OURO }),
  t(120, 960, 840, 200, "Descontos em produtos selecionados", {
    fontSize: 46,
    fontWeight: 400,
    color: OURO_CLARO,
    align: "center",
  }),
  t(120, 1520, 840, 60, "Fale com o seu colaborador INUKA", {
    fontSize: 32,
    fontWeight: 500,
    color: CINZA,
    align: "center",
  }),
  icone("heart", 500, 1680, 80, OURO),
]);

const formacao = pagina("Formação", fundo("#111111"), [
  forma("rect", 0, 0, 24, 1080, { fill: OURO }),
  icone("calendar", 90, 110, 72),
  t(90, 220, 700, 60, "FORMAÇÃO", {
    fontSize: 30,
    fontWeight: 600,
    letterSpacing: 10,
    color: OURO,
  }),
  t(90, 300, 900, 220, "Técnicas de venda\nINUKA", {
    fontSize: 96,
    fontWeight: 700,
    lineHeight: 1.05,
  }),
  t(90, 580, 860, 180, "Sessão prática para vendedores: abordagem ao cliente, demonstração de produto e fecho de venda.", {
    fontSize: 34,
    fontWeight: 400,
    color: CINZA,
    lineHeight: 1.45,
  }),
  forma("rect", 90, 820, 420, 76, { fill: OURO, radius: 8 }),
  t(110, 840, 380, 40, "Confirmar presença", {
    fontSize: 28,
    fontWeight: 600,
    color: PRETO,
    align: "center",
  }),
  t(90, 940, 700, 50, "Data e local a anunciar no Connect", {
    fontSize: 26,
    fontWeight: 400,
    color: CINZA,
  }),
]);

const aviso = pagina("Aviso", fundo("#0A0A0A"), [
  forma("rect", 60, 60, 960, 960, {
    fill: "rgba(201,169,98,0.06)",
    stroke: "rgba(201,169,98,0.35)",
    strokeWidth: 2,
    radius: 24,
  }),
  icone("megaphone", 92, 110, 80),
  t(92, 230, 860, 60, "COMUNICADO", {
    fontSize: 30,
    fontWeight: 600,
    letterSpacing: 12,
    color: OURO,
  }),
  t(92, 320, 880, 240, "Título do comunicado", {
    fontSize: 88,
    fontWeight: 700,
    lineHeight: 1.05,
  }),
  t(92, 590, 860, 260, "Escreva aqui a informação que a equipa precisa de conhecer. Seja direto e indique o que fazer a seguir.", {
    fontSize: 34,
    fontWeight: 400,
    color: CINZA,
    lineHeight: 1.5,
  }),
  forma("line", 96, 900, 140, 4, { fill: OURO }),
  t(92, 930, 700, 44, "Gestão INUKA Angola", {
    fontSize: 26,
    fontWeight: 500,
    color: OURO_CLARO,
  }),
]);

const flyer = pagina("Flyer", fundo("#0D0D0D"), [
  forma("rect", 0, 0, 1240, 420, { fill: "rgba(201,169,98,0.14)" }),
  t(90, 110, 900, 60, "INUKA ANGOLA", {
    fontSize: 32,
    fontWeight: 600,
    letterSpacing: 14,
    color: OURO,
  }),
  t(90, 190, 1060, 200, "Beleza que\nacompanha você", {
    fontSize: 96,
    fontWeight: 700,
    lineHeight: 1,
  }),
  t(90, 500, 1060, 60, "Perfumaria · Corpo · Cabelo · Maquilhagem", {
    fontSize: 32,
    fontWeight: 500,
    color: OURO_CLARO,
  }),
  t(90, 610, 1060, 260, "Conheça a linha completa no catálogo da plataforma e fale com um colaborador autorizado na sua província.", {
    fontSize: 32,
    fontWeight: 400,
    color: CINZA,
    lineHeight: 1.55,
  }),
  forma("line", 92, 920, 300, 3, { fill: OURO }),
  t(90, 960, 500, 50, "Contacto", {
    fontSize: 26,
    fontWeight: 600,
    color: OURO,
    uppercase: true,
    letterSpacing: 6,
  }),
  t(90, 1010, 700, 60, "+244 900 000 000", { fontSize: 34, fontWeight: 500 }),
  t(90, 1070, 800, 60, "vendas@inuka.ao", { fontSize: 34, fontWeight: 400, color: CINZA }),
  forma("rect", 0, 1554, 1240, 200, { fill: "rgba(201,169,98,0.14)" }),
  t(90, 1620, 1060, 60, "ALWAYS WITH YOU", {
    fontSize: 30,
    fontWeight: 600,
    letterSpacing: 16,
    color: OURO,
    align: "center",
  }),
]);

const capa = pagina("Capa", gradiente("#1A1509", "#0A0A0A", 120), [
  icone("sparkles", 70, 60, 52),
  t(140, 66, 700, 50, "INUKA", {
    fontSize: 28,
    fontWeight: 600,
    letterSpacing: 12,
    color: OURO,
  }),
  t(70, 190, 800, 200, "Catálogo\nde produtos", {
    fontSize: 84,
    fontWeight: 700,
    lineHeight: 1.05,
  }),
  t(70, 430, 760, 60, "Atualizado pela gestão INUKA Angola", {
    fontSize: 28,
    fontWeight: 400,
    color: CINZA,
  }),
  forma("line", 940, 200, 3, 260, { fill: OURO }),
  icone("shopping-bag", 980, 300, 90, OURO_CLARO),
]);

const testemunho = pagina("Testemunho", fundo("#101010"), [
  icone("quote", 90, 100, 90, OURO),
  t(90, 260, 900, 380, "“Escreva aqui o testemunho de um cliente satisfeito com os produtos INUKA.”", {
    fontSize: 62,
    fontWeight: 400,
    lineHeight: 1.3,
    italic: true,
  }),
  forma("line", 94, 700, 120, 3, { fill: OURO }),
  t(90, 740, 700, 50, "Nome do cliente", { fontSize: 32, fontWeight: 600 }),
  t(90, 790, 700, 50, "Cliente INUKA", { fontSize: 26, fontWeight: 400, color: CINZA }),
  icone("star", 90, 900, 44),
  icone("star", 150, 900, 44),
  icone("star", 210, 900, 44),
  icone("star", 270, 900, 44),
  icone("star", 330, 900, 44),
]);

export const TEMPLATES: Seed[] = [
  {
    id: "tpl-promocao",
    title: "Promoção dourada",
    description: "Anúncio de coleção com título grande e moldura fina.",
    category: "promocao",
    format_key: "square",
    width: 1080,
    height: 1080,
    thumbnail: null,
    pages: [promocao],
  },
  {
    id: "tpl-produto",
    title: "Destaque de produto",
    description: "Produto ao centro com botão para o catálogo.",
    category: "produto",
    format_key: "square",
    width: 1080,
    height: 1080,
    thumbnail: null,
    pages: [produto],
  },
  {
    id: "tpl-story",
    title: "Story de promoção",
    description: "Formato vertical 9:16 para stories e reels.",
    category: "promocao",
    format_key: "story",
    width: 1080,
    height: 1920,
    thumbnail: null,
    pages: [story],
  },
  {
    id: "tpl-formacao",
    title: "Formação de vendedores",
    description: "Convite para sessão de formação.",
    category: "formacao",
    format_key: "square",
    width: 1080,
    height: 1080,
    thumbnail: null,
    pages: [formacao],
  },
  {
    id: "tpl-aviso",
    title: "Comunicado da gestão",
    description: "Aviso interno com hierarquia clara.",
    category: "aviso",
    format_key: "square",
    width: 1080,
    height: 1080,
    thumbnail: null,
    pages: [aviso],
  },
  {
    id: "tpl-flyer",
    title: "Flyer A4",
    description: "Flyer para imprimir ou exportar em PDF.",
    category: "impressao",
    format_key: "a4",
    width: 1240,
    height: 1754,
    thumbnail: null,
    pages: [flyer],
  },
  {
    id: "tpl-capa",
    title: "Capa de catálogo",
    description: "Imagem de partilha 1200×630.",
    category: "produto",
    format_key: "capa",
    width: 1200,
    height: 630,
    thumbnail: null,
    pages: [capa],
  },
  {
    id: "tpl-testemunho",
    title: "Testemunho de cliente",
    description: "Citação com avaliação em estrelas.",
    category: "social",
    format_key: "square",
    width: 1080,
    height: 1080,
    thumbnail: null,
    pages: [testemunho],
  },
];

/** Recria os ids para o modelo poder ser aplicado várias vezes sem colidir. */
export function instanciarTemplate(template: DesignTemplate): DesignPage[] {
  return template.pages.map((p, i) => ({
    ...p,
    id: novoId(),
    name: p.name || `Página ${i + 1}`,
    background: { ...p.background },
    elements: p.elements.map((el) => ({ ...el, id: novoId() })),
  }));
}

export function templatePorId(id: string): DesignTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
