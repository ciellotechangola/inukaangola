/**
 * Semeia conversas reais na base: o grupo da empresa e duas conversas directas.
 *
 * Idempotente — correr duas vezes não duplica nada.
 *
 *   node supabase/seed-chat.mjs
 *
 * Usa o `service_role` porque está a montar estrutura, não a conversar: o RLS
 * não deixa um cliente criar um grupo nem inscrever terceiros.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const env = {};
  for (const linha of readFileSync(resolve(AQUI, "../apps/web/.env.local"), "utf8").split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const SR = env.SUPABASE_SERVICE_ROLE_KEY;

/** `--reset` reescreve as mensagens das conversas semeadas. */
const RESET = process.argv.includes("--reset");

if (!BASE || !SR) {
  console.error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY em apps/web/.env.local");
  process.exit(1);
}

async function sb(path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      apikey: SR,
      Authorization: `Bearer ${SR}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const txt = await res.text();
  let data = null;
  try {
    data = txt ? JSON.parse(txt) : null;
  } catch {
    data = txt;
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const perfis = await sb("/rest/v1/profiles?select=id,full_name,role,phone&order=role");
const porPapel = (r) => perfis.filter((p) => p.role === r);
const gestores = porPapel("manager");
const colaboradores = porPapel("seller");
const clientes = porPapel("customer");

if (gestores.length === 0) {
  console.error("Não há nenhum gestor. Crie um antes de semear o chat.");
  process.exit(1);
}

const autor = gestores[0];
console.log(`Autor das mensagens: ${autor.full_name}`);
console.log(`${gestores.length} gestores · ${colaboradores.length} colaboradores · ${clientes.length} clientes\n`);

/** Procura uma directa entre duas pessoas (exactamente dois membros). */
async function directaExistente(a, b) {
  const linhas = await sb(
    `/rest/v1/conversations?select=id,type,conversation_members(user_id)&type=eq.direct`
  );
  for (const c of linhas) {
    const ids = (c.conversation_members ?? []).map((m) => m.user_id).sort();
    if (ids.length === 2 && ids[0] === [a, b].sort()[0] && ids[1] === [a, b].sort()[1]) return c.id;
  }
  return null;
}

async function directa(a, b) {
  const existente = await directaExistente(a, b);
  if (existente) {
    console.log(`· directa já existe (${existente.slice(0, 8)}…)`);
    return existente;
  }
  const [conv] = await sb("/rest/v1/conversations", {
    method: "POST",
    prefer: "return=representation",
    body: { type: "direct", created_by: a },
  });
  await sb("/rest/v1/conversation_members", {
    method: "POST",
    prefer: "return=minimal",
    body: [
      { conversation_id: conv.id, user_id: a },
      { conversation_id: conv.id, user_id: b },
    ],
  });
  console.log(`· directa criada (${conv.id.slice(0, 8)}…)`);
  return conv.id;
}

async function mensagensDe(convId) {
  const linhas = await sb(`/rest/v1/messages?conversation_id=eq.${convId}&select=id`);
  return linhas.length;
}

async function dizerTudo(convId, pares) {
  if (RESET) {
    await sb(`/rest/v1/messages?conversation_id=eq.${convId}`, {
      method: "DELETE",
      prefer: "return=minimal",
    });
    console.log("  (mensagens anteriores apagadas)");
  } else if ((await mensagensDe(convId)) > 0) {
    // A verificação é feita uma vez por conversa, não por mensagem — senão a
    // segunda mensagem do par via "já tem mensagens" (a primeira) e era saltada.
    console.log("  (já tem mensagens, não repito)");
    return;
  }
  for (const [senderId, content] of pares) {
    await sb("/rest/v1/messages", {
      method: "POST",
      prefer: "return=minimal",
      body: { conversation_id: convId, sender_id: senderId, content },
    });
    console.log(`  “${content.slice(0, 48)}…”`);
  }
}

// --- 1. Grupo da empresa -----------------------------------------------------
const TITULO = "Equipa INUKA — Comercial";
const grupos = await sb(`/rest/v1/conversations?select=id,title&type=eq.group&title=eq.${encodeURIComponent(TITULO)}`);

let grupoId = grupos[0]?.id;
if (grupoId) {
  console.log(`· grupo já existe (${grupoId.slice(0, 8)}…)`);
} else {
  const [conv] = await sb("/rest/v1/conversations", {
    method: "POST",
    prefer: "return=representation",
    body: { type: "group", title: TITULO, created_by: autor.id },
  });
  grupoId = conv.id;

  const membros = [
    ...gestores.map((g) => ({ conversation_id: grupoId, user_id: g.id, role: "admin" })),
    ...colaboradores.map((c) => ({ conversation_id: grupoId, user_id: c.id, role: "member" })),
  ];
  await sb("/rest/v1/conversation_members", {
    method: "POST",
    prefer: "return=minimal",
    body: membros,
  });
  await sb("/rest/v1/groups", {
    method: "POST",
    prefer: "return=minimal",
    body: {
      conversation_id: grupoId,
      name: TITULO,
      description: "Coordenação diária entre gerência e colaboradores.",
      created_by: autor.id,
      is_private: true,
    },
  });
  console.log(`· grupo criado (${grupoId.slice(0, 8)}…) com ${membros.length} participantes`);
}

await dizerTudo(grupoId, [
  [
    autor.id,
    "Bem-vindos ao grupo comercial da INUKA. Usem este espaço para combinar encomendas, stock e entregas do dia.",
  ],
]);

// --- 2. Directas -------------------------------------------------------------
const cliente = clientes[0];
const colaborador = colaboradores[0];

if (cliente && colaborador) {
  console.log(`\nCliente ↔ colaborador (${cliente.full_name} / ${colaborador.full_name})`);
  const id = await directa(cliente.id, colaborador.id);
  await dizerTudo(id, [
    [cliente.id, "Boa tarde, queria saber se o perfume floral ainda está disponível."],
    [colaborador.id, "Boa tarde! Está sim. Posso reservar para entrega amanhã em Luanda."],
    [cliente.id, "Perfeito, reserve um para mim. Obrigada!"],
  ]);
}

if (cliente && gestores[1]) {
  console.log(`\nCliente ↔ gestor (${cliente.full_name} / ${gestores[1].full_name})`);
  const id = await directa(cliente.id, gestores[1].id);
  await dizerTudo(id, [
    [cliente.id, "Olá, preciso de uma factura da minha última encomenda."],
    [gestores[1].id, "Claro. Envio-lhe ainda hoje por aqui."],
  ]);
}

// --- 3. Anexos de demonstração ----------------------------------------------
// Uma imagem e uma mensagem de voz, para o chat não ser só texto.

async function enviarFicheiro(convId, senderId, bytes, nome, tipo, legenda) {
  const ext = nome.split(".").pop();
  const caminho = `${convId}/${crypto.randomUUID()}.${ext}`;

  const up = await fetch(`${BASE}/storage/v1/object/message-attachments/${caminho}`, {
    method: "POST",
    headers: {
      apikey: SR,
      Authorization: `Bearer ${SR}`,
      "Content-Type": tipo,
      "x-upsert": "false",
    },
    body: bytes,
  });
  if (!up.ok) throw new Error(`upload ${nome}: ${up.status} ${await up.text()}`);

  const [msg] = await sb("/rest/v1/messages", {
    method: "POST",
    prefer: "return=representation",
    body: { conversation_id: convId, sender_id: senderId, content: legenda ?? null },
  });

  await sb("/rest/v1/message_attachments", {
    method: "POST",
    prefer: "return=minimal",
    body: {
      message_id: msg.id,
      storage_path: caminho,
      file_name: nome,
      file_type: tipo,
      file_size: bytes.length,
    },
  });
  console.log(`  ${nome} (${bytes.length} B)`);
}

/** WAV PCM mono — um tom curto e válido, para o <audio> tocar de verdade. */
function tomWav(segundos = 1.4, freq = 220, taxa = 8000) {
  const n = Math.floor(segundos * taxa);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(taxa, 24);
  buf.writeUInt32LE(taxa * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const ataque = Math.min(1, i / (taxa * 0.05));
    const fim = Math.min(1, (n - i) / (taxa * 0.15));
    const v = Math.sin((2 * Math.PI * freq * i) / taxa) * ataque * fim * 0.25;
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

if (cliente && colaborador) {
  const conv = await directaExistente(cliente.id, colaborador.id);

  // PostgREST não aceita subconsulta em `in.(...)`: buscar os ids primeiro.
  let temAnexos = false;
  if (conv) {
    const msgs = await sb(`/rest/v1/messages?select=id&conversation_id=eq.${conv}`);
    const ids = (msgs ?? []).map((m) => m.id);
    if (ids.length > 0) {
      const anexos = await sb(`/rest/v1/message_attachments?select=id&message_id=in.(${ids.join(",")})`);
      temAnexos = Array.isArray(anexos) && anexos.length > 0;
    }
  }

  if (conv && !temAnexos) {
    console.log("\nAnexos de demonstração");
    const imagem = readFileSync(resolve(AQUI, "../apps/web/public/logo-inuka.png"));
    await enviarFicheiro(
      conv,
      colaborador.id,
      imagem,
      "logo-inuka.png",
      "image/png",
      "Este é o frasco que chegou esta semana."
    );
    await enviarFicheiro(conv, cliente.id, tomWav(), "mensagem-de-voz.wav", "audio/wav", null);
  } else if (conv) {
    console.log("\nAnexos: a conversa já tem ficheiros, não repito.");
  }
}

console.log("\nPronto. Abra /conversas ou /gerente/conversas.");
