/**
 * Gera supabase/SETUP_COMPLETO.sql a partir das migrações.
 *
 * O ficheiro único é o que se cola no SQL Editor do Supabase. As migrações
 * em supabase/migrations/ continuam a ser a fonte de verdade — este script
 * só as concatena, para não haver duas cópias a divergir.
 *
 *   node supabase/build-setup.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = HERE; // supabase/

const PARTES = [
  { ficheiro: "migrations/0001_schema.sql", titulo: "ESQUEMA" },
  { ficheiro: "migrations/0002_rls.sql", titulo: "ROW LEVEL SECURITY" },
  { ficheiro: "migrations/0003_rpc.sql", titulo: "LÓGICA DE NEGÓCIO + REALTIME" },
  { ficheiro: "migrations/0004_designer.sql", titulo: "DESIGNER (ESTÚDIO DE DESIGN)" },
  { ficheiro: "migrations/0005_provincias.sql", titulo: "GESTÃO MULTIPROVINCIAL" },
  { ficheiro: "migrations/0006_colaboradores.sql", titulo: "IDENTIDADE E GESTÃO DE COLABORADORES" },
  { ficheiro: "migrations/0007_conteudos.sql", titulo: "CONTEÚDOS PUBLICADOS E FORMAÇÃO" },
  { ficheiro: "migrations/0008_taxas_pedidos.sql", titulo: "TAXA DE COMISSÃO, PEDIDOS E REVENDEDORES" },
  { ficheiro: "migrations/0009_reservas_clientes.sql", titulo: "RESERVA DE CLIENTES E COMPRAS DO CLIENTE" },
];

const cabecalho = `-- =============================================================================
--  INUKA ANGOLA — BASE DE DADOS COMPLETA (SUPABASE)
-- =============================================================================
--  COMO USAR
--  1. Abra o Supabase -> SQL Editor -> New query
--  2. Cole TODO este ficheiro
--  3. Clique em RUN
--
--  É idempotente: pode voltar a executar sem apagar dados.
--
--  DEPOIS DE EXECUTAR, crie o primeiro gestor:
--     SELECT public.promote_to_manager('+244 9xx xxx xxx');
--  (o utilizador tem de já estar registado na app)
--
--  CONTEÚDO
${PARTES.map((p, i) => `--    PARTE ${i + 1}  ${p.titulo}`).join("\n")}
--
--  Gerado por supabase/build-setup.mjs — não editar à mão.
--  A fonte são os ficheiros em supabase/migrations/.
-- =============================================================================
`;

const blocos = PARTES.map((p, i) => {
  const sql = readFileSync(resolve(ROOT, p.ficheiro), "utf8").trimEnd();
  return [
    "",
    "",
    "-- ###########################################################################",
    `-- ##  PARTE ${i + 1} de ${PARTES.length} — ${p.titulo}`,
    "-- ###########################################################################",
    "",
    sql,
  ].join("\n");
});

const saida = cabecalho + blocos.join("\n") + "\n";
writeFileSync(resolve(ROOT, "SETUP_COMPLETO.sql"), saida, "utf8");

console.log(
  `SETUP_COMPLETO.sql gerado: ${PARTES.length} partes, ${saida.split("\n").length} linhas`
);
