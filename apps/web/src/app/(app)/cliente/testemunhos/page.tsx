import { redirect } from "next/navigation";

/**
 * Os testemunhos passaram a viver no Feed Clientes.
 *
 * Havia duas telas para a mesma coisa — a grelha «Testemunhos de Clientes» e o
 * feed — e a grelha era a única que não tinha promoções. Ficou uma só: o
 * cliente abre «Feed Clientes» e tem lá os testemunhos, com o mesmo cartão dos
 * comunicados internos. Este endereço aponta para lá para não deixar ligações
 * antigas em 404.
 *
 * A leitura de um testemunho em tamanho completo continua em
 * `/cliente/testemunhos/[id]`.
 */
export default function TestemunhosPage() {
  redirect("/cliente/conteudo");
}
