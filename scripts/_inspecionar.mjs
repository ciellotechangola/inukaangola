// Script temporário de inspeção — apagar depois de usar.
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../apps/web/.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;

async function q(path) {
  const r = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact" },
  });
  const texto = await r.text();
  return { status: r.status, corpo: texto.slice(0, 4000) };
}

const alvos = [
  "design_projects?select=id,title,owner_id,format_key,width,height,version,is_archived&order=updated_at.desc&limit=12",
  "profiles?select=id,full_name,role,provincia_id&role=eq.manager",
  "design_projects?id=in.(7b919e34-5eda-4b7a-b76f-0b99a2ce8a7f,48144642-d3d2-4aa1-9093-370441ace903)&select=id,title,owner_id,format_key,width,height,pages",
];

for (const a of alvos) {
  const r = await q(a);
  console.log(`\n### ${a}\n${r.status} ${r.corpo}`);
}
