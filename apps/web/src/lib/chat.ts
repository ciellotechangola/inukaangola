"use client";

import { createClientBrowser } from "./supabase-browser";
import { BUCKET_ANEXOS, LIMITE_ANEXO } from "./chat-shared";

export { BUCKET_ANEXOS, LIMITE_ANEXO };

/**
 * Camada de dados do chat.
 *
 * Regra que custou caro neste projecto: **só se embute uma tabela que tenha FK
 * directa para ela.** `conversation_members.user_id`, `messages.sender_id` e
 * `conversations.created_by` apontam para `auth.users`, não para
 * `public.profiles`. Por isso `members:conversation_members(profile:profiles(...))`
 * devolve sempre
 *   «Could not find a relationship between 'conversation_members' and 'profiles'».
 * Aqui os membros vêm por id e os nomes são juntados numa segunda consulta.
 */

export type Papel = "customer" | "seller" | "manager";

export interface Membro {
  id: string;
  full_name: string;
  role: string;
}

export interface Anexo {
  id: string;
  message_id: string;
  storage_path: string;
  file_name: string;
  file_type: string;
  file_size: number;
  /** URL assinado, gerado ao carregar (o bucket é privado). */
  url?: string;
}

export interface Mensagem {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string | null;
  created_at: string;
  anexos?: Anexo[];
  /** Ainda a caminho do servidor (envio optimista). */
  pendente?: boolean;
  /** O servidor recusou. */
  falhou?: boolean;
}

export interface Conversa {
  id: string;
  type: string;
  title: string | null;
  membros: Membro[];
  ultima: Mensagem | null;
  naoLidas: number;
  /** Eu pertenço a esta conversa (o gestor vê todas, mas só é membro das suas). */
  souMembro: boolean;
}

type Cliente = ReturnType<typeof createClientBrowser>;

const LIMITE_CONVERSAS = 60;

/** Nome a mostrar: título do grupo, ou os outros participantes. */
export function nomeConversa(conv: Conversa, euId: string | null): string {
  if (conv.title) return conv.title;
  const outros = conv.membros.filter((m) => m.id !== euId).map((m) => m.full_name);
  if (outros.length > 0) return outros.join(", ");
  return "Conversa";
}

/** Iniciais para o avatar redondo. */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/**
 * Carrega a caixa de entrada.
 *
 * Não ordena por `conversations.updated_at`: essa coluna só muda com UPDATE na
 * conversa, e inserir uma mensagem não a toca. A ordem vem da última mensagem.
 */
export async function carregarInbox(
  supabase: Cliente,
  userId: string,
  papel: Papel
): Promise<Conversa[]> {
  // 1. As minhas participações (dão-me o `last_read_at` e a lista de ids).
  const { data: minhas, error: erroMinhas } = await supabase
    .from("conversation_members")
    .select("conversation_id, last_read_at")
    .eq("user_id", userId);
  if (erroMinhas) throw new Error(erroMinhas.message);

  const lidoEm = new Map<string, string | null>();
  for (const m of minhas ?? []) {
    lidoEm.set((m as { conversation_id: string }).conversation_id, (m as { last_read_at: string | null }).last_read_at);
  }

  // 2. As conversas. O gestor vê todas (política is_manager); os restantes só
  //    as suas — e nesse caso filtramos explicitamente pelos ids.
  let consulta = supabase.from("conversations").select("id, type, title, members:conversation_members(user_id)");
  if (papel !== "manager") {
    const ids = [...lidoEm.keys()];
    if (ids.length === 0) return [];
    consulta = consulta.in("id", ids);
  }

  const { data: conversasRaw, error: erroConversas } = await consulta.limit(LIMITE_CONVERSAS);
  if (erroConversas) throw new Error(erroConversas.message);

  const conversas = (conversasRaw ?? []) as unknown as {
    id: string;
    type: string;
    title: string | null;
    members: { user_id: string }[];
  }[];
  if (conversas.length === 0) return [];

  // 3. Nomes dos membros, numa segunda consulta (ver nota no topo).
  const idsMembros = [...new Set(conversas.flatMap((c) => c.members.map((m) => m.user_id)))];
  const { data: perfis } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .in("id", idsMembros);

  const porId = new Map<string, Membro>();
  for (const p of (perfis ?? []) as Membro[]) porId.set(p.id, p);

  // 4. Última mensagem e não lidas, por conversa, em paralelo.
  const detalhes = await Promise.all(
    conversas.map(async (c) => {
      const souMembro = lidoEm.has(c.id);
      const desde = lidoEm.get(c.id) ?? null;

      const { data: ultimas } = await supabase
        .from("messages")
        .select(
          "id, conversation_id, sender_id, content, created_at, anexos:message_attachments(file_type)"
        )
        .eq("conversation_id", c.id)
        .order("created_at", { ascending: false })
        .limit(1);

      const ultima = ((ultimas ?? [])[0] ?? null) as Mensagem | null;

      // Só conta como não lida para quem é membro. O gestor que observa uma
      // conversa alheia não tem `last_read_at` e não deve ver badge nenhum.
      let naoLidas = 0;
      const porLer = souMembro && ultima && ultima.sender_id !== userId &&
        (!desde || new Date(ultima.created_at) > new Date(desde));

      if (porLer) {
        let contagem = supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", c.id)
          .neq("sender_id", userId);
        if (desde) contagem = contagem.gt("created_at", desde);
        const { count } = await contagem;
        naoLidas = count ?? 0;
      }

      return { id: c.id, ultima, naoLidas, souMembro };
    })
  );

  const detalhePorId = new Map(detalhes.map((d) => [d.id, d]));

  const saida: Conversa[] = conversas.map((c) => {
    const d = detalhePorId.get(c.id)!;
    return {
      id: c.id,
      type: c.type,
      title: c.title,
      membros: c.members.map((m) => porId.get(m.user_id)).filter((m): m is Membro => Boolean(m)),
      ultima: d.ultima,
      naoLidas: d.naoLidas,
      souMembro: d.souMembro,
    };
  });

  // Ordem: última mensagem primeiro; sem mensagens, no fim.
  saida.sort((a, b) => {
    const ta = a.ultima ? new Date(a.ultima.created_at).getTime() : 0;
    const tb = b.ultima ? new Date(b.ultima.created_at).getTime() : 0;
    return tb - ta;
  });

  return saida;
}

/** Assina uma lista de anexos de uma vez (o bucket é privado). */
export async function assinarAnexos(supabase: Cliente, anexos: Anexo[]): Promise<Anexo[]> {
  if (anexos.length === 0) return anexos;

  const { data, error } = await supabase.storage
    .from(BUCKET_ANEXOS)
    .createSignedUrls(
      anexos.map((a) => a.storage_path),
      60 * 60 * 6
    );

  if (error || !data) return anexos;

  const urlPorCaminho = new Map(
    data.filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl as string])
  );

  return anexos.map((a) => ({ ...a, url: urlPorCaminho.get(a.storage_path) ?? undefined }));
}

export async function carregarMensagens(supabase: Cliente, conversationId: string): Promise<Mensagem[]> {
  const { data, error } = await supabase
    .from("messages")
    .select(
      "id, conversation_id, sender_id, content, created_at, anexos:message_attachments(id, message_id, storage_path, file_name, file_type, file_size)"
    )
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(300);
  if (error) throw new Error(error.message);

  const linhas = (data ?? []) as unknown as Mensagem[];
  const todos = linhas.flatMap((m) => m.anexos ?? []);
  const assinados = await assinarAnexos(supabase, todos);
  const porId = new Map(assinados.map((a) => [a.id, a]));

  return linhas.map((m) => ({
    ...m,
    anexos: (m.anexos ?? []).map((a) => porId.get(a.id) ?? a),
  }));
}

/** Anexos de uma mensagem que chegou por realtime (o payload não os traz). */
export async function carregarAnexosDe(supabase: Cliente, messageId: string): Promise<Anexo[]> {
  const { data } = await supabase
    .from("message_attachments")
    .select("id, message_id, storage_path, file_name, file_type, file_size")
    .eq("message_id", messageId);
  return assinarAnexos(supabase, (data ?? []) as Anexo[]);
}

function extensao(nome: string, tipo: string): string {
  const doNome = nome.includes(".") ? nome.split(".").pop()!.toLowerCase() : "";
  if (doNome && /^[a-z0-9]{1,5}$/.test(doNome)) return doNome;
  const porTipo: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "application/pdf": "pdf",
  };
  return porTipo[tipo] ?? "bin";
}

/**
 * Envia ficheiro e/ou texto.
 *
 * A pasta tem de ser o id da conversa: a política do bucket lê
 * `(storage.foldername(name))[1]` e exige que seja uma conversa de que se é
 * membro. O nome no storage é um uuid — o nome original fica só na tabela.
 */
export async function enviarComAnexo(
  supabase: Cliente,
  conversationId: string,
  userId: string,
  ficheiro: File,
  legenda: string
): Promise<{ mensagem: Mensagem; anexo: Anexo }> {
  if (ficheiro.size <= 0) throw new Error("O ficheiro está vazio.");
  if (ficheiro.size > LIMITE_ANEXO) throw new Error("O ficheiro passa dos 20 MB.");

  const tipo = ficheiro.type || "application/octet-stream";
  const caminho = `${conversationId}/${crypto.randomUUID()}.${extensao(ficheiro.name, tipo)}`;

  const envio = await supabase.storage.from(BUCKET_ANEXOS).upload(caminho, ficheiro, {
    contentType: tipo,
    upsert: false,
  });
  if (envio.error) throw new Error(envio.error.message);

  try {
    const { data: msg, error: erroMsg } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: userId,
        content: legenda.trim() ? legenda.trim() : null,
      })
      .select("id, conversation_id, sender_id, content, created_at")
      .single();
    if (erroMsg) throw new Error(erroMsg.message);

    const mensagem = msg as Mensagem;

    const { data: anexo, error: erroAnexo } = await supabase
      .from("message_attachments")
      .insert({
        message_id: mensagem.id,
        storage_path: caminho,
        file_name: ficheiro.name,
        file_type: tipo,
        file_size: ficheiro.size,
      })
      .select("id, message_id, storage_path, file_name, file_type, file_size")
      .single();

    if (erroAnexo) {
      // A mensagem ficou sem anexo: apagar para não deixar uma bolha vazia.
      await supabase.from("messages").delete().eq("id", mensagem.id);
      throw new Error(erroAnexo.message);
    }

    const [comUrl] = await assinarAnexos(supabase, [anexo as Anexo]);
    return { mensagem, anexo: comUrl };
  } catch (e) {
    // Não deixar o ficheiro órfão no bucket.
    await supabase.storage.from(BUCKET_ANEXOS).remove([caminho]);
    throw e;
  }
}

/**
 * Envia. O gestor que não é membro tem de entrar primeiro: a política
 * `messages_insert` exige `is_conversation_member(...)`, e isso é intencional —
 * um gestor não deve escrever numa conversa sem nela figurar.
 */
export async function enviarMensagem(
  supabase: Cliente,
  conversationId: string,
  userId: string,
  content: string
): Promise<Mensagem> {
  const { data, error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, sender_id: userId, content })
    .select("id, conversation_id, sender_id, content, created_at")
    .single();
  if (error) throw new Error(error.message);
  return data as Mensagem;
}

/** Põe o gestor na conversa para poder responder. */
export async function entrarNaConversa(supabase: Cliente, conversationId: string, userId: string) {
  const { error } = await supabase
    .from("conversation_members")
    .insert({ conversation_id: conversationId, user_id: userId });
  // 23505 = já é membro; não é erro para o utilizador.
  if (error && !error.message.includes("duplicate key")) throw new Error(error.message);
}

export async function marcarLida(supabase: Cliente, conversationId: string) {
  // Falha com 42501 se não for membro (gestor a observar) — não é erro.
  await supabase.rpc("mark_conversation_read", { p_conversation_id: conversationId });
}

export interface Contacto {
  id: string;
  full_name: string;
  role: string;
}

export async function carregarContactos(): Promise<Contacto[]> {
  const r = await fetch("/api/contactos", { cache: "no-store" });
  if (!r.ok) throw new Error("Não foi possível carregar os contactos.");
  const corpo = (await r.json()) as { contactos?: Contacto[] };
  return corpo.contactos ?? [];
}

export async function abrirConversaDirecta(otherUserId: string): Promise<string> {
  const supabase = createClientBrowser();
  const { data, error } = await supabase.rpc("get_or_create_direct_conversation", {
    p_other_user: otherUserId,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function criarGrupo(
  supabase: Cliente,
  userId: string,
  nome: string,
  membros: string[]
): Promise<string> {
  const { data: conv, error: erroConv } = await supabase
    .from("conversations")
    .insert({ type: "group", title: nome, created_by: userId })
    .select("id")
    .single();
  if (erroConv) throw new Error(erroConv.message);

  const conversationId = (conv as { id: string }).id;

  const { error: erroMembros } = await supabase.from("conversation_members").insert([
    { conversation_id: conversationId, user_id: userId, role: "admin" },
    ...membros.filter((m) => m !== userId).map((m) => ({ conversation_id: conversationId, user_id: m, role: "member" })),
  ]);
  if (erroMembros) throw new Error(erroMembros.message);

  const { error: erroGrupo } = await supabase.from("groups").insert({
    conversation_id: conversationId,
    name: nome,
    created_by: userId,
    is_private: true,
  });
  if (erroGrupo) throw new Error(erroGrupo.message);

  return conversationId;
}

/** Etiquetas e formatos partilhados pela interface. */
export const ETIQUETA_PAPEL: Record<string, string> = {
  manager: "gestor",
  seller: "colaborador",
  customer: "cliente",
};

export function horaCurta(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
}

/** Como no WhatsApp: hora hoje, "Ontem", dia da semana nesta semana, senão data. */
export function quandoCurto(iso: string): string {
  const d = new Date(iso);
  const agora = new Date();
  const dia = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDias = Math.round((dia(agora) - dia(d)) / 86_400_000);

  if (diffDias === 0) return horaCurta(iso);
  if (diffDias === 1) return "Ontem";
  if (diffDias < 7) return d.toLocaleDateString("pt-PT", { weekday: "short" });
  return d.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: d.getFullYear() === agora.getFullYear() ? undefined : "2-digit" });
}

/** Separador de dia dentro da conversa. */
export function rotuloDia(iso: string): string {
  const d = new Date(iso);
  const agora = new Date();
  const dia = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDias = Math.round((dia(agora) - dia(d)) / 86_400_000);

  if (diffDias === 0) return "Hoje";
  if (diffDias === 1) return "Ontem";
  return d.toLocaleDateString("pt-PT", { day: "2-digit", month: "long", year: "numeric" });
}

export function mesmoDia(a: string, b: string): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** Pré-visualização na lista: uma mensagem só-com-anexo não tem texto. */
export function previa(m: Mensagem | null): string {
  if (!m) return "Sem mensagens";
  if (m.content) return m.content;
  const tipo = m.anexos?.[0]?.file_type ?? "";
  if (tipo.startsWith("image/")) return "Imagem";
  if (tipo.startsWith("audio/")) return "Mensagem de voz";
  if (tipo) return "Ficheiro";
  return "Mensagem";
}
