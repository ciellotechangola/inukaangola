import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2];
const files = [
  "tests/00_stub_supabase.sql",
  "migrations/0001_schema.sql",
  "migrations/0002_rls.sql",
  "migrations/0003_rpc.sql",
  "migrations/0004_designer.sql",
  "migrations/0005_provincias.sql",
  "migrations/0006_colaboradores.sql",
  "migrations/0007_conteudos.sql",
  "migrations/0008_taxas_pedidos.sql",
  "migrations/0009_reservas_clientes.sql",
  "migrations/0010_taxa_entrega.sql",
  "migrations/0011_chat_equipa.sql",
  "migrations/0012_stock_publico.sql",
  "migrations/0013_perfis_loja.sql",
  "migrations/0014_eliminar_forcado.sql",
];

const db = new PGlite();

let failed = false;

for (const rel of files) {
  const full = path.join(root, rel);
  // PGlite não inclui pgcrypto; Postgres 13+ tem gen_random_uuid() nativo.
  // No Supabase a extensão existe, por isso a linha mantém-se nos ficheiros.
  const sql = fs
    .readFileSync(full, "utf8")
    .replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;/g, "");
  process.stdout.write(`\n=== ${rel} ===\n`);
  try {
    await db.exec(sql);
    console.log("OK");
  } catch (e) {
    failed = true;
    console.log("ERRO: " + e.message);
    if (e.position) console.log("posição: " + e.position);
    if (e.hint) console.log("dica: " + e.hint);
    if (e.detail) console.log("detalhe: " + e.detail);
    if (e.where) console.log("onde: " + e.where);
  }
}

// Inventário do que foi criado
try {
  const t = await db.query(
    `select table_name from information_schema.tables where table_schema='public' order by 1`
  );
  console.log(`\nTabelas criadas (${t.rows.length}):`);
  console.log(t.rows.map((r) => r.table_name).join(", "));

  const p = await db.query(
    `select count(*)::int as n from pg_policies where schemaname='public'`
  );
  console.log(`\nPolíticas RLS (public): ${p.rows[0].n}`);

  const f = await db.query(
    `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' order by 1`
  );
  console.log(`\nFunções (${f.rows.length}):`);
  console.log(f.rows.map((r) => r.proname).join(", "));

  const e = await db.query(`select typname from pg_type where typtype='e' order by 1`);
  console.log(`\nEnums: ${e.rows.map((r) => r.typname).join(", ")}`);
} catch (e) {
  console.log("Inventário falhou: " + e.message);
}

await db.close();
process.exit(failed ? 1 : 0);
