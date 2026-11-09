"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Download,
  FileText,
  MessageSquarePlus,
  Mic,
  Paperclip,
  Search,
  Send,
  Square,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import {
  abrirConversaDirecta,
  adicionarMembroGrupo,
  carregarAnexosDe,
  carregarContactos,
  carregarInbox,
  carregarMensagens,
  criarGrupo,
  entrarNaConversa,
  enviarComAnexo,
  enviarMensagem,
  ETIQUETA_PAPEL,
  horaCurta,
  iniciais,
  LIMITE_ANEXO,
  marcarLida,
  mesmoDia,
  nomeConversa,
  previa,
  quandoCurto,
  removerMembroGrupo,
  rotuloDia,
  type Anexo,
  type Contacto,
  type Conversa,
  type Mensagem,
  type Papel,
} from "@/lib/chat";

interface Props {
  /** Para onde volta a seta do topo. */
  voltarHref: string;
  voltarLabel: string;
  /** Texto mostrado quando ainda não há conversas. */
  vazioTexto?: string;
}

function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Um anexo dentro da bolha.
 *
 * `next/image` não serve: os URLs são assinados e o host muda, e um host não
 * declarado rebenta a página inteira (já aconteceu com o catálogo). `<img>`
 * simples é o correcto aqui.
 */
function VistaAnexo({ anexo }: { anexo: Anexo }) {
  const tipo = anexo.file_type ?? "";

  if (tipo.startsWith("image/")) {
    if (!anexo.url) {
      return <div className="h-40 w-52 animate-pulse rounded-lg bg-black/20" />;
    }
    return (
      <a href={anexo.url} target="_blank" rel="noreferrer" title={anexo.file_name}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={anexo.url}
          alt={anexo.file_name}
          className="max-h-64 w-full max-w-[16rem] rounded-lg object-cover"
        />
      </a>
    );
  }

  if (tipo.startsWith("audio/")) {
    if (!anexo.url) {
      return <div className="h-10 w-52 animate-pulse rounded-lg bg-black/20" />;
    }
    return <audio controls src={anexo.url} className="h-10 w-56 max-w-full" />;
  }

  const conteudo = (
    <>
      <FileText className="h-5 w-5 shrink-0 opacity-80" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{anexo.file_name}</span>
        <span className="block text-[10px] opacity-70">{formatarTamanho(anexo.file_size)}</span>
      </span>
      <Download className="h-4 w-4 shrink-0 opacity-70" />
    </>
  );

  const classes = "flex items-center gap-2 rounded-lg bg-black/15 px-2.5 py-2";

  return anexo.url ? (
    <a href={anexo.url} target="_blank" rel="noreferrer" download={anexo.file_name} className={classes}>
      {conteudo}
    </a>
  ) : (
    <div className={classes}>{conteudo}</div>
  );
}

function ChatInner({ voltarHref, voltarLabel, vazioTexto }: Props) {
  const searchParams = useSearchParams();
  const pedido = searchParams.get("c");

  const [eu, setEu] = useState<{ id: string; nome: string; papel: Papel } | null>(null);
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [rascunho, setRascunho] = useState("");
  const [erro, setErro] = useState("");
  const [aCarregar, setACarregar] = useState(true);
  const [aEnviar, setAEnviar] = useState(false);
  const [modal, setModal] = useState<null | "direct" | "group" | "members">(null);
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [pesquisa, setPesquisa] = useState("");
  const [grupoNome, setGrupoNome] = useState("");
  const [grupoMembros, setGrupoMembros] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [aMexerMembros, setAMexerMembros] = useState<string | null>(null);

  // Anexos
  const [anexo, setAnexo] = useState<{ ficheiro: File; url: string } | null>(null);
  const [aGravar, setAGravar] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const gravadorRef = useRef<MediaRecorder | null>(null);
  const descartarRef = useRef(false);
  const ficheiroRef = useRef<HTMLInputElement>(null);

  const fimRef = useRef<HTMLDivElement>(null);
  const caixaRef = useRef<HTMLDivElement>(null);
  const rascunhoRef = useRef<HTMLTextAreaElement>(null);

  const activa = conversas.find((c) => c.id === activeId) ?? null;
  const titulo = activa ? nomeConversa(activa, eu?.id ?? null) : "";

  /** Junta sem duplicar e mantém ordem cronológica (o realtime pode chegar fora de ordem). */
  const juntarMensagem = useCallback((entrante: Mensagem, substituirId?: string) => {
    setMensagens((prev) => {
      // `substituirId` remove a bolha optimista. Não se compara por conteúdo:
      // duas mensagens só-com-anexo têm `content` nulo e seriam confundidas.
      const base = substituirId ? prev.filter((m) => m.id !== substituirId) : prev;
      if (base.some((m) => m.id === entrante.id)) return base;
      return [...base, entrante].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    });
  }, []);

  const recarregarInbox = useCallback(async (userId: string, papel: Papel) => {
    const supabase = createClientBrowser();
    const lista = await carregarInbox(supabase, userId, papel);
    setConversas(lista);
    return lista;
  }, []);

  // --- Arranque -------------------------------------------------------------
  useEffect(() => {
    let cancelado = false;
    const supabase = createClientBrowser();

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelado) {
        setACarregar(false);
        return;
      }

      const { data: perfil } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", user.id)
        .single();

      const papel = ((perfil as { role?: string } | null)?.role ?? "customer") as Papel;
      if (cancelado) return;
      setEu({
        id: user.id,
        nome: (perfil as { full_name?: string } | null)?.full_name ?? "Eu",
        papel,
      });

      try {
        const lista = await recarregarInbox(user.id, papel);
        if (cancelado) return;

        const alvo = pedido && lista.some((c) => c.id === pedido) ? pedido : null;
        if (alvo) {
          setActiveId(alvo);
        } else if (window.matchMedia("(min-width: 768px)").matches && lista.length > 0) {
          // No telemóvel abrimos na lista, como o WhatsApp.
          setActiveId(lista[0].id);
        }
      } catch (e) {
        if (!cancelado) setErro(e instanceof Error ? e.message : "Falha ao carregar as conversas.");
      } finally {
        if (!cancelado) setACarregar(false);
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [pedido, recarregarInbox]);

  // --- Conversa activa ------------------------------------------------------
  useEffect(() => {
    if (!activeId || !eu) return;
    let cancelado = false;
    const supabase = createClientBrowser();

    (async () => {
      try {
        const lista = await carregarMensagens(supabase, activeId);
        if (!cancelado) setMensagens(lista);
      } catch (e) {
        if (!cancelado) setErro(e instanceof Error ? e.message : "Falha ao carregar as mensagens.");
      }
      await marcarLida(supabase, activeId);
      if (!cancelado) {
        setConversas((prev) =>
          prev.map((c) => (c.id === activeId ? { ...c, naoLidas: 0 } : c))
        );
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [activeId, eu]);

  // --- Realtime -------------------------------------------------------------
  // Sem filtro por conversa: um único canal serve a conversa aberta e a lista.
  // O RLS do Realtime só entrega linhas que este utilizador pode ver.
  useEffect(() => {
    if (!eu) return;
    const supabase = createClientBrowser();

    const canal = supabase
      .channel(`chat:${eu.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const nova = payload.new as Mensagem;
          if (nova.conversation_id === activeId) {
            juntarMensagem(nova);
            // O payload do realtime não traz anexos: uma mensagem sem texto é
            // uma mensagem com ficheiro, e os URLs têm de ser assinados.
            if (nova.content === null) {
              carregarAnexosDe(createClientBrowser(), nova.id)
                .then((anexos) =>
                  setMensagens((prev) =>
                    prev.map((m) => (m.id === nova.id ? { ...m, anexos } : m))
                  )
                )
                .catch(() => {});
            }
          }

          setConversas((prev) => {
            const existe = prev.some((c) => c.id === nova.conversation_id);
            if (!existe) {
              // Conversa nova (alguém falou comigo pela primeira vez).
              recarregarInbox(eu.id, eu.papel).catch(() => {});
              return prev;
            }
            return prev
              .map((c) =>
                c.id === nova.conversation_id
                  ? {
                      ...c,
                      ultima: nova,
                      naoLidas:
                        nova.conversation_id === activeId || nova.sender_id === eu.id
                          ? 0
                          : c.naoLidas + 1,
                    }
                  : c
              )
              .sort((a, b) => {
                const ta = a.ultima ? new Date(a.ultima.created_at).getTime() : 0;
                const tb = b.ultima ? new Date(b.ultima.created_at).getTime() : 0;
                return tb - ta;
              });
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [eu, activeId, juntarMensagem, recarregarInbox]);

  // Apagar chega aos outros ecrãs: sem isto, a mensagem ficava à vista de quem
  // já tinha a conversa aberta. O `payload.old` de um DELETE traz só a chave.
  useEffect(() => {
    if (!eu) return;
    const supabase = createClientBrowser();

    const canal = supabase
      .channel(`apagar:${eu.id}`)
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages" },
        (payload) => {
          const antiga = payload.old as { id?: string };
          if (!antiga?.id) return;
          setMensagens((prev) => prev.filter((m) => m.id !== antiga.id));
          recarregarInbox(eu.id, eu.papel).catch(() => {});
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "conversations" },
        (payload) => {
          const antiga = payload.old as { id?: string };
          if (!antiga?.id) return;
          setConversas((prev) => prev.filter((c) => c.id !== antiga.id));
          setActiveId((atual) => {
            if (atual !== antiga.id) return atual;
            setMensagens([]);
            return null;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [eu, recarregarInbox]);

  // --- Scroll ---------------------------------------------------------------
  const pertoDoFim = useRef(true);

  useEffect(() => {
    const caixa = caixaRef.current;
    if (!caixa) return;
    const aoRolar = () => {
      pertoDoFim.current = caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight < 120;
    };
    caixa.addEventListener("scroll", aoRolar);
    return () => caixa.removeEventListener("scroll", aoRolar);
  }, []);

  useEffect(() => {
    if (pertoDoFim.current) fimRef.current?.scrollIntoView({ block: "end" });
  }, [mensagens]);

  useEffect(() => {
    // Ao abrir outra conversa, mostrar o fim sem animação.
    pertoDoFim.current = true;
    const caixa = caixaRef.current;
    if (caixa) caixa.scrollTop = caixa.scrollHeight;
  }, [activeId]);

  // --- Anexos ---------------------------------------------------------------
  function escolherFicheiro(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // permite escolher o mesmo ficheiro outra vez
    if (!f) return;
    if (f.size <= 0) {
      setErro("O ficheiro está vazio.");
      return;
    }
    if (f.size > LIMITE_ANEXO) {
      setErro("O ficheiro passa dos 20 MB.");
      return;
    }
    if (anexo) URL.revokeObjectURL(anexo.url);
    setAnexo({ ficheiro: f, url: URL.createObjectURL(f) });
    setErro("");
    rascunhoRef.current?.focus();
  }

  function limparAnexo() {
    if (anexo) URL.revokeObjectURL(anexo.url);
    setAnexo(null);
  }

  async function alternarGravacao() {
    if (aGravar) {
      gravadorRef.current?.stop();
      return;
    }

    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setErro("Este navegador não permite gravar áudio.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const suportado = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find(
        (t) => MediaRecorder.isTypeSupported?.(t)
      );
      const gravador = new MediaRecorder(stream, suportado ? { mimeType: suportado } : undefined);
      const pedacos: Blob[] = [];
      descartarRef.current = false;

      gravador.ondataavailable = (ev) => {
        if (ev.data.size > 0) pedacos.push(ev.data);
      };

      gravador.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setAGravar(false);
        setSegundos(0);
        gravadorRef.current = null;

        if (descartarRef.current || pedacos.length === 0) return;

        const tipo = gravador.mimeType || "audio/webm";
        const ext = tipo.includes("mp4") ? "m4a" : tipo.includes("ogg") ? "ogg" : "webm";
        const blob = new Blob(pedacos, { type: tipo });
        const ficheiro = new File([blob], `voz-${Date.now()}.${ext}`, { type: tipo });

        if (anexo) URL.revokeObjectURL(anexo.url);
        setAnexo({ ficheiro, url: URL.createObjectURL(blob) });
        setErro("");
      };

      gravador.start();
      gravadorRef.current = gravador;
      setAGravar(true);
      setSegundos(0);
      setErro("");
    } catch {
      setErro("Sem acesso ao microfone. Autorize no navegador e tente de novo.");
    }
  }

  function cancelarGravacao() {
    descartarRef.current = true;
    gravadorRef.current?.stop();
  }

  useEffect(() => {
    if (!aGravar) return;
    const t = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [aGravar]);

  // --- Acções ---------------------------------------------------------------
  async function enviar() {
    const texto = rascunho.trim();
    if ((!texto && !anexo) || !activeId || !eu || aEnviar) return;

    setErro("");
    setAEnviar(true);
    setRascunho("");

    const supabase = createClientBrowser();
    const tempId = `tmp-${Date.now()}`;
    const ficheiro = anexo?.ficheiro ?? null;
    const urlLocal = anexo?.url ?? null;

    const temporaria: Mensagem = {
      id: tempId,
      conversation_id: activeId,
      sender_id: eu.id,
      content: texto || null,
      created_at: new Date().toISOString(),
      pendente: true,
      anexos:
        ficheiro && urlLocal
          ? [
              {
                id: tempId,
                message_id: tempId,
                storage_path: "",
                file_name: ficheiro.name,
                file_type: ficheiro.type,
                file_size: ficheiro.size,
                url: urlLocal,
              },
            ]
          : undefined,
    };

    pertoDoFim.current = true;
    setMensagens((prev) => [...prev, temporaria]);
    setAnexo(null);

    try {
      let real: Mensagem;
      if (ficheiro) {
        const r = await enviarComAnexo(supabase, activeId, eu.id, ficheiro, texto);
        real = { ...r.mensagem, anexos: [r.anexo] };
      } else {
        real = await enviarMensagem(supabase, activeId, eu.id, texto);
      }

      juntarMensagem(real, tempId);
      setConversas((prev) =>
        prev
          .map((c) => (c.id === activeId ? { ...c, ultima: real, souMembro: true } : c))
          .sort((a, b) => {
            const ta = a.ultima ? new Date(a.ultima.created_at).getTime() : 0;
            const tb = b.ultima ? new Date(b.ultima.created_at).getTime() : 0;
            return tb - ta;
          })
      );
    } catch (e) {
      setMensagens((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, pendente: false, falhou: true } : m))
      );
      setErro(e instanceof Error ? e.message : "Não foi possível enviar.");
    } finally {
      if (urlLocal) URL.revokeObjectURL(urlLocal);
      setAEnviar(false);
      rascunhoRef.current?.focus();
    }
  }

  async function entrar() {
    if (!activeId || !eu) return;
    const supabase = createClientBrowser();
    try {
      await entrarNaConversa(supabase, activeId, eu.id);
      setConversas((prev) => prev.map((c) => (c.id === activeId ? { ...c, souMembro: true } : c)));
      rascunhoRef.current?.focus();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível entrar na conversa.");
    }
  }

  // --- Apagar ---------------------------------------------------------------
  async function apagarMensagem(m: Mensagem) {
    if (m.pendente) return;
    if (!window.confirm("Apagar esta mensagem? Desaparece para todos.")) return;

    setErro("");
    try {
      const r = await fetch(`/api/mensagens/${m.id}`, { method: "DELETE" });
      if (!r.ok) {
        const corpo = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(corpo.error ?? `Não foi possível apagar (${r.status}).`);
      }
      setMensagens((prev) => prev.filter((x) => x.id !== m.id));
      if (eu) await recarregarInbox(eu.id, eu.papel).catch(() => {});
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível apagar a mensagem.");
    }
  }

  async function apagarConversa() {
    if (!activa) return;

    const pergunta =
      activa.type === "group"
        ? `Apagar o grupo “${titulo}”? As mensagens e os ficheiros desaparecem para todos os participantes.`
        : `Apagar a conversa com ${titulo}? As mensagens e os ficheiros desaparecem para ambos.`;

    if (!window.confirm(pergunta)) return;

    setErro("");
    try {
      const r = await fetch(`/api/conversas/${activa.id}`, { method: "DELETE" });
      if (!r.ok) {
        const corpo = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(corpo.error ?? `Não foi possível apagar (${r.status}).`);
      }
      setConversas((prev) => prev.filter((c) => c.id !== activa.id));
      setMensagens([]);
      setActiveId(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível apagar a conversa.");
    }
  }

  async function abrirModal(modo: "direct" | "group" | "members") {
    setModal(modo);
    setErro("");
    setPesquisa("");
    if (contactos.length === 0) {
      try {
        setContactos(await carregarContactos());
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao carregar contactos.");
      }
    }
  }

  async function escolherContacto(id: string) {
    if (!eu) return;
    setOcupado(true);
    setErro("");
    try {
      const conversaId = await abrirConversaDirecta(id);
      const lista = await recarregarInbox(eu.id, eu.papel);
      setModal(null);
      setActiveId(conversaId);
      if (!lista.some((c) => c.id === conversaId)) {
        // Conversa recém-criada ainda não estava na lista local.
        const supabase = createClientBrowser();
        setConversas(await carregarInbox(supabase, eu.id, eu.papel));
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível abrir a conversa.");
    } finally {
      setOcupado(false);
    }
  }

  async function submeterGrupo() {
    if (!eu) return;
    if (!grupoNome.trim()) {
      setErro("Dê um nome ao grupo.");
      return;
    }
    setOcupado(true);
    setErro("");
    try {
      const id = await criarGrupo(grupoNome.trim(), grupoMembros);
      await recarregarInbox(eu.id, eu.papel);
      setModal(null);
      setGrupoNome("");
      setGrupoMembros([]);
      setActiveId(id);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível criar o grupo.");
    } finally {
      setOcupado(false);
    }
  }

  /** Acrescenta ou tira alguém do grupo aberto (só gestão). */
  async function alternarMembroDoGrupo(userId: string, dentro: boolean) {
    if (!activa || !eu) return;
    setAMexerMembros(userId);
    setErro("");
    try {
      if (dentro) await removerMembroGrupo(activa.id, userId);
      else await adicionarMembroGrupo(activa.id, userId);

      // Recarregar a caixa de entrada actualiza `activa.membros` — é dela que
      // sai a lista de participantes e o nome do grupo.
      const lista = await recarregarInbox(eu.id, eu.papel);
      if (!lista.some((c) => c.id === activa.id)) setActiveId(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível alterar os membros.");
    } finally {
      setAMexerMembros(null);
    }
  }

  const contactosFiltrados = useMemo(() => {
    const q = pesquisa.trim().toLowerCase();
    if (!q) return contactos;
    return contactos.filter(
      (c) => c.full_name.toLowerCase().includes(q) || ETIQUETA_PAPEL[c.role]?.includes(q)
    );
  }, [contactos, pesquisa]);

  const totalNaoLidas = conversas.reduce((soma, c) => soma + c.naoLidas, 0);

  // --- Interface ------------------------------------------------------------
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href={voltarHref} className="inline-flex items-center gap-1.5 text-sm text-[#A3A3A3] hover:text-[#C9A962]">
          <ArrowLeft className="h-4 w-4" />
          {voltarLabel}
        </Link>
        {totalNaoLidas > 0 && (
          <span className="rounded-full bg-[#C9A962] px-2.5 py-0.5 text-xs font-semibold text-[#0A0A0A]">
            {totalNaoLidas} por ler
          </span>
        )}
      </div>

      {erro && (
        <div className="mb-3 flex items-start justify-between gap-3 rounded-lg bg-red-950/50 p-3 text-sm text-red-200">
          <span>{erro}</span>
          <button onClick={() => setErro("")} aria-label="Fechar aviso">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="grid h-[calc(100dvh-13rem)] min-h-[26rem] overflow-hidden rounded-xl border border-[#262626] bg-[#141414] md:grid-cols-[320px_1fr]">
        {/* ---------------- Lista ---------------- */}
        <aside
          className={`${activeId ? "hidden md:flex" : "flex"} min-h-0 flex-col border-r border-[#262626]`}
        >
          <header className="flex items-center justify-between gap-2 border-b border-[#262626] px-3 py-3">
            <h1 className="text-base font-medium text-[#F5F5F5]">Mensagens</h1>
            <div className="flex items-center gap-1">
              <button
                onClick={() => abrirModal("direct")}
                title="Nova conversa"
                aria-label="Nova conversa"
                className="rounded-lg p-2 text-[#A3A3A3] transition hover:bg-[#262626] hover:text-[#C9A962]"
              >
                <MessageSquarePlus className="h-4 w-4" />
              </button>
              {eu?.papel === "manager" && (
                <button
                  onClick={() => abrirModal("group")}
                  title="Novo grupo"
                  aria-label="Novo grupo"
                  className="rounded-lg p-2 text-[#A3A3A3] transition hover:bg-[#262626] hover:text-[#C9A962]"
                >
                  <Users className="h-4 w-4" />
                </button>
              )}
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {aCarregar ? (
              <p className="p-6 text-center text-sm text-[#8A8A8A]">A carregar…</p>
            ) : conversas.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-sm text-[#A3A3A3]">
                  {vazioTexto ?? "Ainda não tem conversas."}
                </p>
                <button
                  onClick={() => abrirModal("direct")}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#C9A962] px-3 py-2 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A]"
                >
                  <MessageSquarePlus className="h-4 w-4" />
                  Nova conversa
                </button>
              </div>
            ) : (
              conversas.map((c) => {
                const nome = nomeConversa(c, eu?.id ?? null);
                const seleccionada = c.id === activeId;
                return (
                  <button
                    key={c.id}
                    onClick={() => setActiveId(c.id)}
                    className={`flex w-full items-center gap-3 border-b border-[#1F1F1F] px-3 py-3 text-left transition ${
                      seleccionada ? "bg-[#C9A962]/10" : "hover:bg-[#1A1A1A]"
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                        c.type === "group"
                          ? "bg-[#262626] text-[#C9A962]"
                          : "bg-[#C9A962]/15 text-[#C9A962]"
                      }`}
                    >
                      {c.type === "group" ? <Users className="h-4 w-4" /> : iniciais(nome)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-[#F5F5F5]">{nome}</span>
                        <span className="shrink-0 text-[11px] text-[#6F6F6F]">
                          {c.ultima ? quandoCurto(c.ultima.created_at) : ""}
                        </span>
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-[#8A8A8A]">
                          {c.ultima?.sender_id === eu?.id ? "Tu: " : ""}
                          {previa(c.ultima)}
                        </span>
                        {c.naoLidas > 0 && (
                          <span className="shrink-0 rounded-full bg-[#C9A962] px-1.5 py-0.5 text-[10px] font-bold text-[#0A0A0A]">
                            {c.naoLidas > 99 ? "99+" : c.naoLidas}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* ---------------- Conversa ---------------- */}
        <section className={`${activeId ? "flex" : "hidden md:flex"} min-h-0 flex-col`}>
          {!activa ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <MessageSquarePlus className="h-8 w-8 text-[#3A3A3A]" />
              <p className="text-sm text-[#A3A3A3]">Escolha uma conversa ou comece uma nova.</p>
            </div>
          ) : (
            <>
              <header className="flex items-center gap-3 border-b border-[#262626] px-3 py-3">
                <button
                  onClick={() => setActiveId(null)}
                  className="rounded-lg p-1.5 text-[#A3A3A3] transition hover:bg-[#262626] md:hidden"
                  aria-label="Voltar à lista"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#C9A962]/15 text-[11px] font-semibold text-[#C9A962]">
                  {activa.type === "group" ? <Users className="h-4 w-4" /> : iniciais(titulo)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[#F5F5F5]">{titulo}</p>
                  <p className="truncate text-[11px] text-[#6F6F6F]">
                    {activa.type === "group"
                      ? `grupo da equipa · ${activa.membros.length} ${activa.membros.length === 1 ? "membro" : "membros"}`
                      : (ETIQUETA_PAPEL[activa.membros.find((m) => m.id !== eu?.id)?.role ?? ""] ??
                        "conversa directa")}
                  </p>
                </div>
                {eu?.papel === "manager" && (
                  <>
                    {activa.type === "group" && (
                      <button
                        onClick={() => abrirModal("members")}
                        title="Membros do grupo"
                        aria-label="Membros do grupo"
                        className="ml-auto shrink-0 rounded-lg p-2 text-[#8A8A8A] transition hover:bg-[#262626] hover:text-[#C9A962]"
                      >
                        <UserPlus className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      onClick={apagarConversa}
                      title={activa.type === "group" ? "Apagar grupo" : "Apagar conversa"}
                      aria-label={activa.type === "group" ? "Apagar grupo" : "Apagar conversa"}
                      className={`${activa.type === "group" ? "" : "ml-auto"} shrink-0 rounded-lg p-2 text-[#8A8A8A] transition hover:bg-[#262626] hover:text-red-400`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </header>

              <div ref={caixaRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-4">
                {mensagens.length === 0 ? (
                  <p className="py-8 text-center text-sm text-[#525252]">
                    Ainda sem mensagens. Escreva a primeira.
                  </p>
                ) : (
                  mensagens.map((m, i) => {
                    const minha = m.sender_id === eu?.id;
                    const anterior = mensagens[i - 1];
                    const abreDia = !anterior || !mesmoDia(anterior.created_at, m.created_at);
                    const autor = activa.membros.find((x) => x.id === m.sender_id);
                    const mostraAutor =
                      !minha &&
                      activa.type === "group" &&
                      (!anterior ||
                        anterior.sender_id !== m.sender_id ||
                        abreDia);

                    return (
                      <div key={m.id}>
                        {abreDia && (
                          <div className="my-3 flex justify-center">
                            <span className="rounded-full bg-[#262626] px-3 py-0.5 text-[10px] uppercase tracking-wider text-[#8A8A8A]">
                              {rotuloDia(m.created_at)}
                            </span>
                          </div>
                        )}
                        <div className={`flex ${minha ? "justify-end" : "justify-start"}`}>
                          <div
                            className={`max-w-[85%] rounded-2xl px-3.5 py-2 sm:max-w-[70%] ${
                              minha
                                ? m.falhou
                                  ? "bg-red-900/60 text-red-100"
                                  : "bg-[#C9A962] text-[#0A0A0A]"
                                : "bg-[#262626] text-[#F5F5F5]"
                            } ${m.pendente ? "opacity-70" : ""}`}
                          >
                            {mostraAutor && (
                              <p className="mb-0.5 text-[11px] font-medium text-[#C9A962]">
                                {autor?.full_name ?? "Participante"}
                              </p>
                            )}
                            {m.anexos && m.anexos.length > 0 && (
                              <div className="mb-1 space-y-1.5">
                                {m.anexos.map((a) => (
                                  <VistaAnexo key={a.id} anexo={a} />
                                ))}
                              </div>
                            )}
                            {m.content && (
                              <p className="whitespace-pre-wrap break-words text-sm">{m.content}</p>
                            )}
                            <p
                              className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
                                minha ? "text-[#0A0A0A]/60" : "text-[#8A8A8A]"
                              }`}
                            >
                              {m.falhou ? "não enviada" : horaCurta(m.created_at)}
                              {minha && !m.falhou && !m.pendente && <Check className="h-3 w-3" />}
                              {(minha || eu?.papel === "manager") && !m.pendente && (
                                <button
                                  onClick={() => apagarMensagem(m)}
                                  title="Apagar mensagem"
                                  aria-label="Apagar mensagem"
                                  className={`rounded p-0.5 transition ${
                                    minha
                                      ? "text-[#0A0A0A]/35 hover:text-[#0A0A0A]"
                                      : "text-[#6F6F6F] hover:text-red-400"
                                  }`}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={fimRef} />
              </div>

              {!activa.souMembro ? (
                <div className="border-t border-[#262626] p-3">
                  <p className="mb-2 text-xs text-[#8A8A8A]">
                    Está a observar esta conversa. Entre para poder responder.
                  </p>
                  <button
                    onClick={entrar}
                    className="rounded-lg bg-[#C9A962] px-4 py-2 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A]"
                  >
                    Entrar na conversa
                  </button>
                </div>
              ) : (
                <div className="border-t border-[#262626]">
                  {anexo && (
                    <div className="flex items-center gap-3 border-b border-[#1F1F1F] px-3 py-2">
                      {anexo.ficheiro.type.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={anexo.url}
                          alt=""
                          className="h-11 w-11 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded bg-[#262626] text-[#C9A962]">
                          {anexo.ficheiro.type.startsWith("audio/") ? (
                            <Mic className="h-5 w-5" />
                          ) : (
                            <FileText className="h-5 w-5" />
                          )}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-[#E5E5E5]">
                          {anexo.ficheiro.name}
                        </span>
                        <span className="block text-[10px] text-[#6F6F6F]">
                          {formatarTamanho(anexo.ficheiro.size)}
                        </span>
                      </span>
                      <button
                        onClick={limparAnexo}
                        aria-label="Remover anexo"
                        className="rounded p-1.5 text-[#8A8A8A] hover:bg-[#262626] hover:text-[#E5E5E5]"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  {aGravar ? (
                    <div className="flex items-center gap-3 px-3 py-3">
                      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                      <span className="text-sm text-[#E5E5E5]">
                        A gravar… {String(Math.floor(segundos / 60)).padStart(2, "0")}:
                        {String(segundos % 60).padStart(2, "0")}
                      </span>
                      <button
                        onClick={cancelarGravacao}
                        className="ml-auto text-xs text-[#8A8A8A] hover:text-[#E5E5E5]"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={alternarGravacao}
                        className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-500"
                      >
                        <Square className="h-3.5 w-3.5" />
                        Parar
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-end gap-1.5 p-2.5">
                      <input ref={ficheiroRef} type="file" hidden onChange={escolherFicheiro} />
                      <button
                        onClick={() => ficheiroRef.current?.click()}
                        title="Anexar ficheiro ou imagem"
                        aria-label="Anexar ficheiro ou imagem"
                        className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl text-[#A3A3A3] transition hover:bg-[#262626] hover:text-[#C9A962]"
                      >
                        <Paperclip className="h-5 w-5" />
                      </button>

                      <textarea
                        ref={rascunhoRef}
                        value={rascunho}
                        onChange={(e) => {
                          setRascunho(e.target.value);
                          const el = e.target;
                          el.style.height = "auto";
                          el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            enviar();
                          }
                        }}
                        rows={1}
                        placeholder="Escrever mensagem…"
                        className="max-h-[120px] min-h-[42px] min-w-0 flex-1 resize-none rounded-xl border border-[#404040] bg-[#0A0A0A] px-3 py-2.5 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
                      />

                      {rascunho.trim() || anexo ? (
                        <button
                          onClick={enviar}
                          disabled={aEnviar}
                          aria-label="Enviar"
                          className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-[#C9A962] text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-40"
                        >
                          <Send className="h-4 w-4" />
                        </button>
                      ) : (
                        <button
                          onClick={alternarGravacao}
                          title="Gravar mensagem de voz"
                          aria-label="Gravar mensagem de voz"
                          className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl text-[#A3A3A3] transition hover:bg-[#262626] hover:text-[#C9A962]"
                        >
                          <Mic className="h-5 w-5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* ---------------- Modais ---------------- */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
          onClick={() => setModal(null)}
        >
          <div
            className="max-h-[85dvh] w-full max-w-md overflow-hidden rounded-t-2xl border border-[#2A2A2A] bg-[#141414] sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-[#262626] px-4 py-3">
              <h2 className="text-sm font-medium text-[#F5F5F5]">
                {modal === "direct"
                  ? "Nova conversa"
                  : modal === "group"
                    ? "Novo grupo da equipa"
                    : "Membros do grupo"}
              </h2>
              <button onClick={() => setModal(null)} aria-label="Fechar" className="text-[#8A8A8A] hover:text-[#E5E5E5]">
                <X className="h-4 w-4" />
              </button>
            </header>

            {modal === "direct" ? (
              <div className="flex max-h-[70dvh] flex-col">
                <div className="border-b border-[#262626] p-3">
                  <div className="flex items-center gap-2 rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2">
                    <Search className="h-4 w-4 text-[#525252]" />
                    <input
                      value={pesquisa}
                      onChange={(e) => setPesquisa(e.target.value)}
                      placeholder="Procurar pessoa…"
                      className="min-w-0 flex-1 bg-transparent text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:outline-none"
                    />
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {contactosFiltrados.length === 0 ? (
                    <p className="p-6 text-center text-sm text-[#8A8A8A]">
                      {contactos.length === 0
                        ? "Ainda não há contactos disponíveis. A gerência tem de o associar a um colaborador."
                        : "Ninguém com esse nome."}
                    </p>
                  ) : (
                    contactosFiltrados.map((c) => (
                      <button
                        key={c.id}
                        disabled={ocupado}
                        onClick={() => escolherContacto(c.id)}
                        className="flex w-full items-center gap-3 border-b border-[#1F1F1F] px-4 py-3 text-left transition hover:bg-[#1A1A1A] disabled:opacity-50"
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#C9A962]/15 text-[11px] font-semibold text-[#C9A962]">
                          {iniciais(c.full_name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-[#F5F5F5]">{c.full_name}</span>
                          <span className="block text-[11px] text-[#6F6F6F]">
                            {ETIQUETA_PAPEL[c.role] ?? c.role}
                          </span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : modal === "group" ? (
              <div className="flex max-h-[70dvh] flex-col">
                <div className="border-b border-[#262626] p-3">
                  <input
                    value={grupoNome}
                    onChange={(e) => setGrupoNome(e.target.value)}
                    placeholder="Nome do grupo (ex.: Equipa comercial)"
                    className="w-full rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
                  />
                  <p className="mt-2 text-[11px] leading-snug text-[#6F6F6F]">
                    Grupos são só para membros da empresa. Os clientes falam em privado com a
                    gestão — não entram aqui.
                  </p>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {contactos.filter((c) => c.role !== "customer").length === 0 ? (
                    <p className="p-6 text-center text-sm text-[#8A8A8A]">
                      Ainda não há colaboradores activos para juntar.
                    </p>
                  ) : (
                    contactos
                      .filter((c) => c.role !== "customer")
                      .map((c) => (
                        <label
                          key={c.id}
                          className="flex cursor-pointer items-center gap-3 border-b border-[#1F1F1F] px-4 py-3 hover:bg-[#1A1A1A]"
                        >
                          <input
                            type="checkbox"
                            checked={grupoMembros.includes(c.id)}
                            onChange={(e) =>
                              setGrupoMembros((prev) =>
                                e.target.checked ? [...prev, c.id] : prev.filter((m) => m !== c.id)
                              )
                            }
                            className="accent-[#C9A962]"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-[#F5F5F5]">{c.full_name}</span>
                            <span className="block text-[11px] text-[#6F6F6F]">
                              {ETIQUETA_PAPEL[c.role] ?? c.role}
                            </span>
                          </span>
                        </label>
                      ))
                  )}
                </div>
                <div className="border-t border-[#262626] p-3">
                  <button
                    onClick={submeterGrupo}
                    disabled={ocupado}
                    className="w-full rounded-lg bg-[#C9A962] px-4 py-2.5 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A] disabled:opacity-50"
                  >
                    {ocupado
                      ? "A criar…"
                      : `Criar grupo${grupoMembros.length ? ` (${grupoMembros.length + 1})` : ""}`}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex max-h-[70dvh] flex-col">
                {!activa ? (
                  <p className="p-6 text-center text-sm text-[#8A8A8A]">Escolha um grupo primeiro.</p>
                ) : (
                  <>
                    <div className="min-h-0 flex-1 overflow-y-auto">
                      <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-[#5A5A5A]">
                        No grupo ({activa.membros.length})
                      </p>
                      {activa.membros.map((m) => (
                        <div
                          key={m.id}
                          className="flex items-center gap-3 border-b border-[#1F1F1F] px-4 py-3"
                        >
                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#C9A962]/15 text-[11px] font-semibold text-[#C9A962]">
                            {iniciais(m.full_name)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-[#F5F5F5]">
                              {m.full_name}
                              {m.id === eu?.id && <span className="text-[#6F6F6F]"> · eu</span>}
                            </span>
                            <span className="block text-[11px] text-[#6F6F6F]">
                              {ETIQUETA_PAPEL[m.role] ?? m.role}
                            </span>
                          </span>
                          {m.id !== eu?.id && (
                            <button
                              onClick={() => alternarMembroDoGrupo(m.id, true)}
                              disabled={aMexerMembros === m.id}
                              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#3A3A3A] px-2.5 py-1.5 text-[11px] text-[#C9C9C9] transition hover:border-red-500/60 hover:text-red-300 disabled:opacity-50"
                            >
                              <UserMinus className="h-3.5 w-3.5" />
                              Remover
                            </button>
                          )}
                        </div>
                      ))}

                      {contactos.filter(
                        (c) => c.role !== "customer" && !activa.membros.some((m) => m.id === c.id)
                      ).length > 0 && (
                        <>
                          <p className="px-4 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-[#5A5A5A]">
                            Acrescentar
                          </p>
                          {contactos
                            .filter(
                              (c) => c.role !== "customer" && !activa.membros.some((m) => m.id === c.id)
                            )
                            .map((c) => (
                              <div
                                key={c.id}
                                className="flex items-center gap-3 border-b border-[#1F1F1F] px-4 py-3"
                              >
                                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#262626] text-[11px] font-semibold text-[#8A8A8A]">
                                  {iniciais(c.full_name)}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm text-[#F5F5F5]">
                                    {c.full_name}
                                  </span>
                                  <span className="block text-[11px] text-[#6F6F6F]">
                                    {ETIQUETA_PAPEL[c.role] ?? c.role}
                                  </span>
                                </span>
                                <button
                                  onClick={() => alternarMembroDoGrupo(c.id, false)}
                                  disabled={aMexerMembros === c.id}
                                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[#C9A962]/15 px-2.5 py-1.5 text-[11px] font-medium text-[#C9A962] transition hover:bg-[#C9A962]/25 disabled:opacity-50"
                                >
                                  <UserPlus className="h-3.5 w-3.5" />
                                  Juntar
                                </button>
                              </div>
                            ))}
                        </>
                      )}
                    </div>
                    <div className="border-t border-[#262626] p-3">
                      <button
                        onClick={() => setModal(null)}
                        className="w-full rounded-lg border border-[#404040] px-4 py-2.5 text-sm text-[#E5E5E5] transition hover:border-[#C9A962] hover:text-[#C9A962]"
                      >
                        Fechar
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

export default function Chat(props: Props) {
  return (
    <Suspense
      fallback={<div className="mx-auto max-w-6xl px-4 py-10 text-[#A3A3A3]">A carregar…</div>}
    >
      <ChatInner {...props} />
    </Suspense>
  );
}
