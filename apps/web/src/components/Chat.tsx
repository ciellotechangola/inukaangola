"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
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
 * `useLayoutEffect` no browser, `useEffect` no servidor.
 *
 * A altura do painel tem de estar certa **antes** do primeiro pintado: com
 * `useEffect` o ecrã abria com a altura errada e só depois encolhia. O React
 * avisa quando `useLayoutEffect` corre no servidor — daí a escolha.
 */
const useMedida = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Duas mensagens seguidas da mesma pessoa, com menos de cinco minutos. */
const JANELA_BLOCO = 5 * 60 * 1000;

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
          className="max-h-[22rem] w-auto max-w-full rounded-lg object-cover"
        />
      </a>
    );
  }

  if (tipo.startsWith("audio/")) {
    if (!anexo.url) {
      return <div className="h-10 w-52 animate-pulse rounded-lg bg-black/20" />;
    }
    return <audio controls src={anexo.url} className="h-11 w-72 max-w-full" />;
  }

  const conteudo = (
    <>
      <FileText className="h-5 w-5 shrink-0 opacity-80" />
      <span className="min-w-0 flex-1">
        {/* Um nome de ficheiro longo parte em duas linhas em vez de desaparecer
            no meio de um `truncate`. */}
        <span className="line-clamp-2 break-all text-xs font-medium">{anexo.file_name}</span>
        <span className="block text-[10px] opacity-70">{formatarTamanho(anexo.file_size)}</span>
      </span>
      <Download className="h-4 w-4 shrink-0 opacity-70" />
    </>
  );

  const classes = "flex items-center gap-2 rounded-lg bg-black/15 px-3 py-2.5";

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
  const painelRef = useRef<HTMLDivElement>(null);

  /** Pesquisa na lista de conversas — o mesmo que o Telegram tem no topo. */
  const [pesquisaLista, setPesquisaLista] = useState("");
  /** Altura exacta do painel, medida ao ecrã. `null` = ainda por medir. */
  const [altura, setAltura] = useState<number | null>(null);

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

  // --- Altura do painel -----------------------------------------------------
  // O `h-[calc(100dvh-13rem)]` que aqui estava era um número mágico: com a
  // barra provincial do cabeçalho a aparecer depois do login, o painel ficava
  // alto a mais e o compositor saía do ecrã. Agora mede-se a distância real do
  // topo do painel ao fundo da área visível — e volta a medir quando o teclado
  // do telemóvel abre (`visualViewport`).
  useMedida(() => {
    const medir = () => {
      const el = painelRef.current;
      if (!el) return;
      const topo = el.getBoundingClientRect().top;
      const visivel = window.visualViewport?.height ?? window.innerHeight;
      setAltura(Math.max(340, Math.round(visivel - topo - 12)));
    };

    medir();

    // O cabeçalho cresce quando o perfil carrega (barra provincial). Observar o
    // `body` apanha isso sem um `setTimeout` arbitrário.
    const observador = new ResizeObserver(medir);
    observador.observe(document.body);

    window.addEventListener("resize", medir);
    window.visualViewport?.addEventListener("resize", medir);

    return () => {
      observador.disconnect();
      window.removeEventListener("resize", medir);
      window.visualViewport?.removeEventListener("resize", medir);
    };
  }, []);

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
      // O `onChange` deixa a altura do textarea gravada em linha; sem este
      // reset a caixa ficava alta e vazia depois de enviar.
      if (rascunhoRef.current) rascunhoRef.current.style.height = "auto";
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

  const conversasVisiveis = useMemo(() => {
    const q = pesquisaLista.trim().toLowerCase();
    if (!q) return conversas;
    return conversas.filter((c) => {
      const nome = nomeConversa(c, eu?.id ?? null).toLowerCase();
      const ultima = c.ultima ? previa(c.ultima).toLowerCase() : "";
      return nome.includes(q) || ultima.includes(q);
    });
  }, [conversas, pesquisaLista, eu?.id]);

  // --- Interface ------------------------------------------------------------
  return (
    <main className="mx-auto w-full max-w-[1500px] px-2 pb-3 pt-2 sm:px-4 sm:pt-3">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <Link
          href={voltarHref}
          className="inline-flex items-center gap-1.5 py-1 text-[13px] text-[#A3A3A3] transition hover:text-[#C9A962]"
        >
          <ArrowLeft className="h-4 w-4" />
          {voltarLabel}
        </Link>
        {totalNaoLidas > 0 && (
          <span className="rounded-full bg-[#C9A962] px-2.5 py-0.5 text-[11px] font-semibold text-[#0A0A0A]">
            {totalNaoLidas} por ler
          </span>
        )}
      </div>

      {erro && (
        <div className="mb-2 flex items-start justify-between gap-3 rounded-lg bg-red-950/50 px-3 py-2 text-sm text-red-200">
          <span>{erro}</span>
          <button onClick={() => setErro("")} aria-label="Fechar aviso">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* A altura vem da medição (ver o efeito da altura): em vez de um
          `calc(100dvh - 13rem)` que ficava errado assim que o cabeçalho
          crescia, o painel ocupa exactamente o que sobra até ao fundo do ecrã.
          O `h-[calc(...)]` só serve o primeiro instante, antes da medida — sem
          ele o painel nascia colapsado e dava um salto. */}
      <div
        ref={painelRef}
        style={altura ? { height: `${altura}px` } : undefined}
        className="grid h-[calc(100dvh-11rem)] grid-cols-1 overflow-hidden rounded-2xl border border-[#232323] bg-[#0D0D0D] md:grid-cols-[19rem_1fr] lg:grid-cols-[21rem_1fr]"
      >
        {/* ---------------- Lista ---------------- */}
        <aside
          className={`${activeId ? "hidden md:flex" : "flex"} min-h-0 flex-col border-r border-[#232323] bg-[#111111]`}
        >
          <header className="flex items-center justify-between gap-2 px-3 pb-2.5 pt-3.5 sm:px-4">
            <h1 className="text-[17px] font-medium text-[#F5F5F5]">Mensagens</h1>
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

          {/* Procurar dentro das conversas: com trinta conversas a lista era uma
              rolagem às cegas. */}
          <div className="px-2.5 pb-2.5">
            <div className="flex items-center gap-2 rounded-xl bg-[#1A1A1A] px-3 py-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-[#5F5F5F]" />
              <input
                value={pesquisaLista}
                onChange={(e) => setPesquisaLista(e.target.value)}
                placeholder="Procurar conversa"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-[#F5F5F5] placeholder:text-[#5F5F5F] focus:outline-none"
              />
              {pesquisaLista && (
                <button
                  onClick={() => setPesquisaLista("")}
                  aria-label="Limpar procura"
                  className="text-[#6F6F6F] hover:text-[#F5F5F5]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
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
            ) : conversasVisiveis.length === 0 ? (
              <p className="p-6 text-center text-sm text-[#8A8A8A]">Nada com esse nome.</p>
            ) : (
              conversasVisiveis.map((c) => {
                const nome = nomeConversa(c, eu?.id ?? null);
                const seleccionada = c.id === activeId;
                return (
                  <button
                    key={c.id}
                    onClick={() => setActiveId(c.id)}
                    aria-current={seleccionada ? "true" : undefined}
                    className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-3 text-left transition ${
                      seleccionada ? "bg-[#C9A962]/12" : "hover:bg-[#161616]"
                    }`}
                  >
                    <span
                      className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-[12px] font-semibold ${
                        c.type === "group"
                          ? "bg-[#262626] text-[#C9A962]"
                          : "bg-[#C9A962]/15 text-[#C9A962]"
                      }`}
                    >
                      {c.type === "group" ? <Users className="h-4 w-4" /> : iniciais(nome)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate text-[14px] font-medium text-[#F5F5F5]">
                          {nome}
                        </span>
                        <span className="ml-auto shrink-0 text-[10.5px] text-[#6F6F6F]">
                          {c.ultima ? quandoCurto(c.ultima.created_at) : ""}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className="truncate text-[12.5px] leading-snug text-[#8A8A8A]">
                          {c.ultima?.sender_id === eu?.id ? "Tu: " : ""}
                          {previa(c.ultima)}
                        </span>
                        {c.naoLidas > 0 && (
                          <span className="ml-auto shrink-0 rounded-full bg-[#C9A962] px-1.5 py-0.5 text-[10px] font-bold text-[#0A0A0A]">
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
        <section
          className={`${activeId ? "flex" : "hidden md:flex"} min-h-0 flex-col bg-[#0A0A0A]`}
        >
          {!activa ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-[#161616]">
                <MessageSquarePlus className="h-6 w-6 text-[#4A4A4A]" />
              </span>
              <p className="max-w-xs text-sm text-[#A3A3A3]">
                Escolha uma conversa à esquerda ou comece uma nova.
              </p>
              <button
                onClick={() => abrirModal("direct")}
                className="inline-flex items-center gap-2 rounded-lg bg-[#C9A962] px-3.5 py-2 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A]"
              >
                <MessageSquarePlus className="h-4 w-4" />
                Nova conversa
              </button>
            </div>
          ) : (
            <>
              <header className="flex items-center gap-3 border-b border-[#1F1F1F] bg-[#0F0F0F] px-3 py-2.5 sm:px-4">
                <button
                  onClick={() => setActiveId(null)}
                  className="-ml-1 rounded-lg p-1.5 text-[#A3A3A3] transition hover:bg-[#262626] md:hidden"
                  aria-label="Voltar à lista"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#C9A962]/15 text-[12px] font-semibold text-[#C9A962]">
                  {activa.type === "group" ? <Users className="h-4 w-4" /> : iniciais(titulo)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium leading-tight text-[#F5F5F5]">
                    {titulo}
                  </p>
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
                        className="shrink-0 rounded-lg p-2 text-[#8A8A8A] transition hover:bg-[#262626] hover:text-[#C9A962]"
                      >
                        <UserPlus className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      onClick={apagarConversa}
                      title={activa.type === "group" ? "Apagar grupo" : "Apagar conversa"}
                      aria-label={activa.type === "group" ? "Apagar grupo" : "Apagar conversa"}
                      className="shrink-0 rounded-lg p-2 text-[#8A8A8A] transition hover:bg-[#262626] hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </header>

              <div
                ref={caixaRef}
                className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-6"
              >
                {mensagens.length === 0 ? (
                  <p className="py-10 text-center text-sm text-[#525252]">
                    Ainda sem mensagens. Escreva a primeira.
                  </p>
                ) : (
                  mensagens.map((m, i) => {
                    const minha = m.sender_id === eu?.id;
                    const anterior = mensagens[i - 1];
                    const seguinte = mensagens[i + 1];
                    const abreDia = !anterior || !mesmoDia(anterior.created_at, m.created_at);
                    const autor = activa.membros.find((x) => x.id === m.sender_id);

                    // Bloco = mesma pessoa, mesmo dia, menos de cinco minutos.
                    // É o que dá o ritmo do Telegram: mensagens seguidas ficam
                    // juntas, sem repetir o nome nem o avatar.
                    const junto =
                      !abreDia &&
                      !!anterior &&
                      anterior.sender_id === m.sender_id &&
                      new Date(m.created_at).getTime() -
                        new Date(anterior.created_at).getTime() <
                        JANELA_BLOCO;

                    const fechaBloco =
                      !seguinte ||
                      seguinte.sender_id !== m.sender_id ||
                      !mesmoDia(seguinte.created_at, m.created_at) ||
                      new Date(seguinte.created_at).getTime() -
                        new Date(m.created_at).getTime() >=
                        JANELA_BLOCO;

                    const mostraAutor = !minha && activa.type === "group" && !junto;

                    return (
                      <div key={m.id}>
                        {abreDia && (
                          <div className="my-4 flex justify-center">
                            <span className="rounded-full bg-[#1C1C1C] px-3 py-1 text-[10px] uppercase tracking-wider text-[#8A8A8A]">
                              {rotuloDia(m.created_at)}
                            </span>
                          </div>
                        )}

                        <div
                          className={`group flex items-end gap-2 ${
                            minha ? "justify-end" : "justify-start"
                          } ${junto ? "mt-1" : "mt-3"}`}
                        >
                          {/* No grupo, a cara de quem fala aparece ao lado do
                              fim do bloco — como no Facebook. */}
                          {!minha && activa.type === "group" && (
                            <span
                              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${
                                fechaBloco
                                  ? "bg-[#262626] text-[#C9A962]"
                                  : "invisible bg-transparent"
                              }`}
                              aria-hidden={!fechaBloco}
                            >
                              {iniciais(autor?.full_name ?? "?")}
                            </span>
                          )}

                          <div
                            className={`max-w-[88%] px-3.5 py-2 sm:max-w-[78%] lg:max-w-[min(78%,40rem)] ${
                              minha
                                ? m.falhou
                                  ? "bg-red-900/70 text-red-50"
                                  : "bg-[#C9A962] text-[#0A0A0A]"
                                : "bg-[#1F1F1F] text-[#EDEDED]"
                            } ${m.pendente ? "opacity-70" : ""} rounded-2xl ${
                              fechaBloco ? (minha ? "rounded-br-md" : "rounded-bl-md") : ""
                            }`}
                          >
                            {mostraAutor && (
                              <p className="mb-0.5 text-[11.5px] font-semibold text-[#C9A962]">
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
                              <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                                {m.content}
                              </p>
                            )}

                            <p
                              className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${
                                minha ? "text-[#0A0A0A]/55" : "text-[#8A8A8A]"
                              }`}
                            >
                              {m.falhou ? "não enviada" : horaCurta(m.created_at)}
                              {minha && !m.falhou && !m.pendente && (
                                <Check className="h-3 w-3" />
                              )}
                              {(minha || eu?.papel === "manager") && !m.pendente && (
                                <button
                                  onClick={() => apagarMensagem(m)}
                                  title="Apagar mensagem"
                                  aria-label="Apagar mensagem"
                                  className={`rounded p-0.5 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 ${
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
                <div className="border-t border-[#1F1F1F] bg-[#0F0F0F] px-4 py-4 sm:px-6">
                  <p className="mb-3 text-sm leading-relaxed text-[#A3A3A3]">
                    Está a observar esta conversa. Entre para poder responder.
                  </p>
                  <button
                    onClick={entrar}
                    className="inline-flex h-11 items-center rounded-xl bg-[#C9A962] px-5 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A]"
                  >
                    Entrar na conversa
                  </button>
                </div>
              ) : (
                <div className="border-t border-[#1F1F1F] bg-[#0F0F0F] px-2.5 pb-2.5 pt-2.5 sm:px-4 sm:pb-4 sm:pt-3">
                  {anexo && (
                    <div className="mb-2.5 flex items-center gap-3 rounded-xl border border-[#262626] bg-[#161616] p-2.5">
                      {anexo.ficheiro.type.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={anexo.url}
                          alt=""
                          className="h-12 w-12 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#262626] text-[#C9A962]">
                          {anexo.ficheiro.type.startsWith("audio/") ? (
                            <Mic className="h-5 w-5" />
                          ) : (
                            <FileText className="h-5 w-5" />
                          )}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block break-all text-[13px] leading-snug text-[#EDEDED]">
                          {anexo.ficheiro.name}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-[#8A8A8A]">
                          Pronto a enviar · {formatarTamanho(anexo.ficheiro.size)}
                        </span>
                      </span>
                      <button
                        onClick={limparAnexo}
                        aria-label="Remover anexo"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#8A8A8A] transition hover:bg-[#262626] hover:text-[#EDEDED]"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}

                  {aGravar ? (
                    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-500/30 bg-red-950/30 px-3 py-2.5">
                      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                      <span className="text-sm text-[#EDEDED]">
                        A gravar… {String(Math.floor(segundos / 60)).padStart(2, "0")}:
                        {String(segundos % 60).padStart(2, "0")}
                      </span>
                      <button
                        onClick={cancelarGravacao}
                        className="ml-auto text-xs text-[#A3A3A3] transition hover:text-[#EDEDED]"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={alternarGravacao}
                        className="inline-flex h-10 items-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-500"
                      >
                        <Square className="h-3.5 w-3.5" />
                        Parar
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-end gap-2">
                      <input ref={ficheiroRef} type="file" hidden onChange={escolherFicheiro} />
                      <button
                        onClick={() => ficheiroRef.current?.click()}
                        title="Anexar ficheiro ou imagem"
                        aria-label="Anexar ficheiro ou imagem"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#A3A3A3] transition hover:bg-[#232323] hover:text-[#C9A962]"
                      >
                        <Paperclip className="h-5 w-5" />
                      </button>

                      <div className="min-w-0 flex-1 rounded-2xl border border-[#2A2A2A] bg-[#161616] px-3.5 py-1 transition focus-within:border-[#C9A962]/60">
                        <textarea
                          ref={rascunhoRef}
                          value={rascunho}
                          onChange={(e) => {
                            setRascunho(e.target.value);
                            const el = e.target;
                            el.style.height = "auto";
                            el.style.height = `${Math.min(el.scrollHeight, 176)}px`;
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              enviar();
                            }
                          }}
                          rows={1}
                          placeholder="Escrever mensagem…"
                          className="block max-h-[176px] min-h-[42px] w-full resize-none bg-transparent py-2.5 text-[15px] leading-relaxed text-[#F5F5F5] placeholder:text-[#6F6F6F] focus:outline-none"
                        />
                      </div>

                      {rascunho.trim() || anexo ? (
                        <button
                          onClick={enviar}
                          disabled={aEnviar}
                          aria-label="Enviar"
                          title="Enviar (Enter)"
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#C9A962] text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-40"
                        >
                          <Send className="h-5 w-5" />
                        </button>
                      ) : (
                        <button
                          onClick={alternarGravacao}
                          title="Gravar mensagem de voz"
                          aria-label="Gravar mensagem de voz"
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#A3A3A3] transition hover:bg-[#232323] hover:text-[#C9A962]"
                        >
                          <Mic className="h-5 w-5" />
                        </button>
                      )}
                    </div>
                  )}

                  <p className="mt-2 hidden px-1 text-[11px] text-[#5F5F5F] sm:block">
                    Enter envia · Shift + Enter muda de linha
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* ---------------- Modais ---------------- */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-6"
          onClick={() => setModal(null)}
        >
          <div
            className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-[#262626] bg-[#141414] shadow-2xl sm:max-h-[85dvh] sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#232323] px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold text-[#F5F5F5]">
                  {modal === "direct"
                    ? "Nova conversa"
                    : modal === "group"
                      ? "Novo grupo da equipa"
                      : "Membros do grupo"}
                </h2>
                <p className="mt-0.5 text-xs leading-snug text-[#8A8A8A]">
                  {modal === "direct"
                    ? "Escolha com quem quer falar."
                    : modal === "group"
                      ? "Dê um nome e escolha quem entra."
                      : "Junte ou remova pessoas da equipa."}
                </p>
              </div>
              <button
                onClick={() => setModal(null)}
                aria-label="Fechar"
                className="-mr-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#8A8A8A] transition hover:bg-[#232323] hover:text-[#EDEDED]"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            {modal === "direct" ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="shrink-0 px-4 pb-3 pt-3.5">
                  <div className="flex items-center gap-2.5 rounded-xl border border-[#2A2A2A] bg-[#0F0F0F] px-3.5 py-2.5 transition focus-within:border-[#C9A962]/60">
                    <Search className="h-4 w-4 shrink-0 text-[#6F6F6F]" />
                    <input
                      value={pesquisa}
                      onChange={(e) => setPesquisa(e.target.value)}
                      placeholder="Procurar pessoa…"
                      className="min-w-0 flex-1 bg-transparent text-sm text-[#F5F5F5] placeholder:text-[#6F6F6F] focus:outline-none"
                    />
                    {pesquisa && (
                      <button
                        onClick={() => setPesquisa("")}
                        aria-label="Limpar procura"
                        className="shrink-0 rounded p-0.5 text-[#6F6F6F] hover:text-[#EDEDED]"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                  {contactosFiltrados.length === 0 ? (
                    <p className="px-3 py-8 text-center text-sm leading-relaxed text-[#8A8A8A]">
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
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-[#1E1E1E] disabled:opacity-50"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#C9A962]/15 text-xs font-semibold text-[#C9A962]">
                          {iniciais(c.full_name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-[#F5F5F5]">{c.full_name}</span>
                          <span className="mt-0.5 block text-[11px] text-[#8A8A8A]">
                            {ETIQUETA_PAPEL[c.role] ?? c.role}
                          </span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : modal === "group" ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="shrink-0 px-4 pb-2 pt-3.5">
                  <input
                    value={grupoNome}
                    onChange={(e) => setGrupoNome(e.target.value)}
                    placeholder="Nome do grupo (ex.: Equipa comercial)"
                    className="w-full rounded-xl border border-[#2A2A2A] bg-[#0F0F0F] px-3.5 py-3 text-sm text-[#F5F5F5] placeholder:text-[#6F6F6F] focus:border-[#C9A962]/60 focus:outline-none"
                  />
                  <p className="mt-2 px-1 text-[11px] leading-relaxed text-[#7A7A7A]">
                    Grupos são só para membros da empresa. Os clientes falam em privado com a
                    gestão — não entram aqui.
                  </p>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                  {contactos.filter((c) => c.role !== "customer").length === 0 ? (
                    <p className="px-3 py-8 text-center text-sm leading-relaxed text-[#8A8A8A]">
                      Ainda não há colaboradores activos para juntar.
                    </p>
                  ) : (
                    contactos
                      .filter((c) => c.role !== "customer")
                      .map((c) => (
                        <label
                          key={c.id}
                          className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 transition hover:bg-[#1E1E1E]"
                        >
                          <input
                            type="checkbox"
                            checked={grupoMembros.includes(c.id)}
                            onChange={(e) =>
                              setGrupoMembros((prev) =>
                                e.target.checked ? [...prev, c.id] : prev.filter((m) => m !== c.id)
                              )
                            }
                            className="h-4 w-4 shrink-0 accent-[#C9A962]"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-[#F5F5F5]">{c.full_name}</span>
                            <span className="mt-0.5 block text-[11px] text-[#8A8A8A]">
                              {ETIQUETA_PAPEL[c.role] ?? c.role}
                            </span>
                          </span>
                        </label>
                      ))
                  )}
                </div>
                <div className="shrink-0 border-t border-[#232323] px-4 pb-4 pt-3">
                  <button
                    onClick={submeterGrupo}
                    disabled={ocupado}
                    className="h-11 w-full rounded-xl bg-[#C9A962] text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A] disabled:opacity-50"
                  >
                    {ocupado
                      ? "A criar…"
                      : `Criar grupo${grupoMembros.length ? ` (${grupoMembros.length + 1})` : ""}`}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                {!activa ? (
                  <p className="px-3 py-8 text-center text-sm text-[#8A8A8A]">Escolha um grupo primeiro.</p>
                ) : (
                  <>
                    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[#6F6F6F]">
                        No grupo ({activa.membros.length})
                      </p>
                      {activa.membros.map((m) => (
                        <div key={m.id} className="flex items-center gap-3 rounded-xl px-3 py-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#C9A962]/15 text-xs font-semibold text-[#C9A962]">
                            {iniciais(m.full_name)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-[#F5F5F5]">
                              {m.full_name}
                              {m.id === eu?.id && <span className="text-[#8A8A8A]"> · eu</span>}
                            </span>
                            <span className="mt-0.5 block text-[11px] text-[#8A8A8A]">
                              {ETIQUETA_PAPEL[m.role] ?? m.role}
                            </span>
                          </span>
                          {m.id !== eu?.id && (
                            <button
                              onClick={() => alternarMembroDoGrupo(m.id, true)}
                              disabled={aMexerMembros === m.id}
                              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#3A3A3A] px-3 py-2 text-[11px] text-[#C9C9C9] transition hover:border-red-500/60 hover:text-red-300 disabled:opacity-50"
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
                          <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-[#6F6F6F]">
                            Acrescentar
                          </p>
                          {contactos
                            .filter(
                              (c) => c.role !== "customer" && !activa.membros.some((m) => m.id === c.id)
                            )
                            .map((c) => (
                              <div key={c.id} className="flex items-center gap-3 rounded-xl px-3 py-3">
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#262626] text-xs font-semibold text-[#8A8A8A]">
                                  {iniciais(c.full_name)}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm text-[#F5F5F5]">
                                    {c.full_name}
                                  </span>
                                  <span className="mt-0.5 block text-[11px] text-[#8A8A8A]">
                                    {ETIQUETA_PAPEL[c.role] ?? c.role}
                                  </span>
                                </span>
                                <button
                                  onClick={() => alternarMembroDoGrupo(c.id, false)}
                                  disabled={aMexerMembros === c.id}
                                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#C9A962]/15 px-3 py-2 text-[11px] font-medium text-[#C9A962] transition hover:bg-[#C9A962]/25 disabled:opacity-50"
                                >
                                  <UserPlus className="h-3.5 w-3.5" />
                                  Juntar
                                </button>
                              </div>
                            ))}
                        </>
                      )}
                    </div>
                    <div className="shrink-0 border-t border-[#232323] px-4 pb-4 pt-3">
                      <button
                        onClick={() => setModal(null)}
                        className="h-11 w-full rounded-xl border border-[#3A3A3A] text-sm text-[#EDEDED] transition hover:border-[#C9A962] hover:text-[#C9A962]"
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
