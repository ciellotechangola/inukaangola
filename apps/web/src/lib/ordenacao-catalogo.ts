/**
 * A ORDEM DOS PRODUTOS NOS CATÁLOGOS — uma regra, um sítio.
 *
 * Os dois catálogos da plataforma (o normal, de cliente final, e o de grosso,
 * do revendedor) abrem pela mesma ordem de prioridade:
 *
 *   1.º **Perfumes**
 *   2.º **Cremes**
 *   3.º as restantes categorias
 *
 * Dentro de cada grupo nada muda: a ordem que o produto já trazia — a data de
 * submissão no grosso, a relevância no catálogo de cliente — mantém-se. A
 * prioridade decide **entre** grupos, não **dentro** de um.
 *
 * PORQUE É QUE A REGRA OLHA PARA O NOME DO PRODUTO
 * ------------------------------------------------
 * A base não tem uma categoria «Cremes» nem uma categoria «Perfumes»: tem
 * «Perfumaria Feminina», «Perfumaria Masculina», «Cuidado da Pele», «Cuidado
 * do Corpo», «Modern Me»… E os cremes estão **dentro** das perfumarias — «Creme
 * PARADISE FOR HER» é vendido na categoria Perfumaria Feminina, «Creme LADY
 * DELUXE» em Cuidado da Pele. Uma regra que só olhasse para a categoria
 * punha os cremes à frente dos perfumes (porque a categoria deles começa por
 * «Perfumaria») ou deixava-os espalhados pelo fim.
 *
 * Por isso a classificação é: **o que o produto é** (nome) manda; a categoria
 * é a rede de segurança. Um «Creme …» é creme onde quer que esteja; um
 * «Perfume …» é perfume; o resto decide-se pela categoria.
 *
 * A comparação é sem acentos e sem maiúsculas, e por **palavra** — «Envelope
 * Perfumado» não é um perfume, e não sobe para o topo por causa do adjectivo.
 */

/** Quanto menor, mais acima. */
export const PRIORIDADE = {
  perfumes: 0,
  cremes: 1,
  outros: 2,
} as const;

/** Nome legível do grupo — para legendas e para os testes. */
export const ROTULO_PRIORIDADE: Record<number, string> = {
  [PRIORIDADE.perfumes]: "Perfumes",
  [PRIORIDADE.cremes]: "Cremes",
  [PRIORIDADE.outros]: "Outras categorias",
};

/** Sem acentos, sem maiúsculas, sem espaços a mais. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export interface CategoriaComoEntrada {
  /** `categories.name` na base; `nome` nas funções da revenda. */
  name?: string | null;
  nome?: string | null;
  slug?: string | null;
}

export interface ProdutoComoEntrada {
  /** Nome do produto — é o que diz o que ele é. */
  nome?: string | null;
  categoria?: string | CategoriaComoEntrada | null;
}

function textoDaCategoria(entrada: string | CategoriaComoEntrada | null | undefined): string {
  if (!entrada) return "";
  if (typeof entrada === "string") return normalizar(entrada);
  return normalizar(`${entrada.name ?? entrada.nome ?? ""} ${entrada.slug ?? ""}`);
}

/** A prioridade de uma categoria: 0 perfumes, 1 cremes, 2 o resto. */
export function prioridadeCategoria(
  entrada: string | CategoriaComoEntrada | null | undefined
): number {
  const texto = textoDaCategoria(entrada);
  if (!texto) return PRIORIDADE.outros;
  if (texto.includes("perfum")) return PRIORIDADE.perfumes;
  if (texto.includes("crem")) return PRIORIDADE.cremes;
  return PRIORIDADE.outros;
}

/**
 * A prioridade de um produto.
 *
 * A ordem dos testes não é arbitrária: o **creme** vem primeiro porque um
 * creme pode estar numa categoria de perfumaria, e nesse caso o nome é a
 * informação certa. Só depois se pergunta se é perfume — pelo nome ou pela
 * categoria.
 */
export function prioridadeProduto(produto: ProdutoComoEntrada): number {
  const nome = normalizar(produto.nome ?? "");
  const categoria = produto.categoria ?? null;

  // «Creme …», «Cremes …»: creme em qualquer prateleira.
  if (/\bcreme/.test(nome)) return PRIORIDADE.cremes;

  // «Perfume …» pelo nome, ou uma categoria de perfumaria.
  if (/\bperfume/.test(nome)) return PRIORIDADE.perfumes;
  if (prioridadeCategoria(categoria) === PRIORIDADE.perfumes) return PRIORIDADE.perfumes;

  // Categoria de cremes (se a gestão criar uma).
  if (prioridadeCategoria(categoria) === PRIORIDADE.cremes) return PRIORIDADE.cremes;

  return PRIORIDADE.outros;
}

/**
 * Ordena uma lista de produtos pela prioridade, **preservando a ordem de
 * entrada dentro de cada grupo**.
 *
 * O desempate é o índice original, e não a comparação do `sort` — assim a
 * ordem não depende de o motor ser estável, e a mesma lista dá sempre o mesmo
 * resultado (é isto que faz a ordem sobreviver a um recarregamento).
 */
export function ordenarCatalogo<T>(
  lista: readonly T[],
  produtoDe: (item: T) => ProdutoComoEntrada
): T[] {
  return lista
    .map((item, indice) => ({ item, indice, prioridade: prioridadeProduto(produtoDe(item)) }))
    .sort((a, b) => a.prioridade - b.prioridade || a.indice - b.indice)
    .map((linha) => linha.item);
}
