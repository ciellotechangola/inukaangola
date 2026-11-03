"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Files,
  Image as ImageIcon,
  Layers,
  LayoutTemplate,
  Package,
  PaintBucket,
  SlidersHorizontal,
  Square,
  Type,
} from "lucide-react";
import { CanvasStage } from "./CanvasStage";
import { CatalogoPanel } from "./CatalogoPanel";
import { ConflitoBanner, ExportDialog, HistoricoDialog, PreviewModal, Sheet } from "./Dialogs";
import { ElementView, estiloFundo } from "./ElementView";
import { PropertiesPanel } from "./PropertiesPanel";
import { PublicarDialog } from "./PublicarDialog";
import { TopBar, type EstadoSync } from "./TopBar";
import {
  CamadasPanel,
  FundoPanel,
  ImagensPanel,
  ModelosPanel,
  PaginasPanel,
  FormasPanel,
  TextoPanel,
} from "./ToolPanels";
import {
  apagarAsset,
  apagarProjeto,
  carregarAsset,
  criarProjeto,
  criarSnapshot,
  duplicarProjeto,
  guardarPreferencias,
  guardarProjeto,
  listarAssets,
  listarModelos,
  listarVersoes,
  obterPreferencias,
  publicarModelo,
  renovarImagens,
  restaurarVersao,
} from "@/lib/designer/api";
import {
  apagarRascunho,
  conteudoDiferente,
  guardarRascunho,
  lerRascunho,
  limparRascunhosAntigos,
  type Rascunho,
} from "@/lib/designer/draft";
import {
  capturar,
  construirPdf,
  dataUrlParaBytes,
  descarregar,
  descarregarBlob,
  nomeSeguro,
  paginaPdfDeJpeg,
  partilharFicheiro,
  prepararFontes,
  type FormatoExportacao,
  type PaginaPdf,
} from "@/lib/designer/export";
import { useEditor } from "@/lib/designer/store";
import {
  publicarConteudo,
  TIPOS,
  type EntradaPublicacao,
  type EstadoConteudo,
} from "@/lib/conteudos";
import { createClientBrowser } from "@/lib/supabase-browser";
import { listarProvincias, type Provincia } from "@/lib/provincias";
import {
  PREFERENCIAS_PADRAO,
  type DesignAsset,
  type DesignerPreferences,
  type DesignPage,
  type DesignProject,
  type DesignTemplate,
  type DesignVersionSummary,
} from "@/lib/designer/types";

type Aba =
  | "texto"
  | "imagens"
  | "catalogo"
  | "formas"
  | "fundo"
  | "camadas"
  | "paginas"
  | "modelos"
  | "propriedades";

const FERRAMENTAS: { key: Aba; label: string; Icon: typeof Type; mobile: boolean }[] = [
  { key: "texto", label: "Texto", Icon: Type, mobile: true },
  { key: "imagens", label: "Imagens", Icon: ImageIcon, mobile: true },
  { key: "catalogo", label: "Catálogo", Icon: Package, mobile: false },
  { key: "formas", label: "Formas", Icon: Square, mobile: true },
  { key: "fundo", label: "Fundo", Icon: PaintBucket, mobile: true },
  { key: "camadas", label: "Camadas", Icon: Layers, mobile: true },
  { key: "paginas", label: "Páginas", Icon: Files, mobile: true },
  { key: "modelos", label: "Modelos", Icon: LayoutTemplate, mobile: false },
  { key: "propriedades", label: "Ajustes", Icon: SlidersHorizontal, mobile: false },
];

function esperarPintura(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export function DesignerEditor({
  projeto,
  modelosIniciais,
  podePublicar,
}: {
  projeto: DesignProject;
  modelosIniciais: DesignTemplate[];
  podePublicar: boolean;
}) {
  const router = useRouter();
  const ed = useEditor(projeto.pages);

  const [titulo, setTitulo] = useState(projeto.title);
  const [aba, setAba] = useState<Aba>("texto");
  const [sheet, setSheet] = useState<Aba | null>(null);
  const [estado, setEstado] = useState<EstadoSync>({ tipo: "pronto" });
  const [zoom, setZoom] = useState(0.5);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const [preview, setPreview] = useState(false);
  const [dialogoExportar, setDialogoExportar] = useState(false);
  const [aExportar, setAExportar] = useState(false);
  const [erroExport, setErroExport] = useState<string | null>(null);
  const [paginasExport, setPaginasExport] = useState<DesignPage[] | null>(null);

  const [assets, setAssets] = useState<DesignAsset[]>([]);
  const [aCarregarAsset, setACarregarAsset] = useState(false);
  const [modelos, setModelos] = useState<DesignTemplate[]>(modelosIniciais);
  const [aviso, setAviso] = useState<string | null>(null);

  const [conflito, setConflito] = useState<{ version: number; pages: DesignPage[]; title: string } | null>(
    null
  );

  const [historico, setHistorico] = useState(false);
  const [versoes, setVersoes] = useState<DesignVersionSummary[]>([]);
  const [aCarregarVersoes, setACarregarVersoes] = useState(false);
  const [aProcessarVersao, setAProcessarVersao] = useState(false);
  const [erroHistorico, setErroHistorico] = useState<string | null>(null);

  const [rascunhoPendente, setRascunhoPendente] = useState<Rascunho | null>(null);
  const [temRascunho, setTemRascunho] = useState(false);
  const [prefs, setPrefs] = useState<DesignerPreferences>(PREFERENCIAS_PADRAO);

  const [provincias, setProvincias] = useState<Provincia[]>([]);
  const [dialogoPublicar, setDialogoPublicar] = useState(false);
  const [aPublicar, setAPublicar] = useState(false);
  const [erroPublicar, setErroPublicar] = useState<string | null>(null);
  const [publicado, setPublicado] = useState<{ id: string; status: EstadoConteudo } | null>(null);
  const [miniaturaPublicar, setMiniaturaPublicar] = useState<string | null>(null);

  const rascunhoAtivo = useRef(false);

  const artboardRef = useRef<HTMLDivElement>(null);
  const versao = useRef(projeto.version);
  const salvando = useRef(false);
  const pendente = useRef(false);
  const primeiroRender = useRef(true);
  const ultimoThumb = useRef<{ url: string; em: number }>({ url: "", em: 0 });
  const dadosRef = useRef({ paginas: ed.paginas, titulo });
  dadosRef.current = { paginas: ed.paginas, titulo };

  // --------------------------------------------------------------- carregar
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [lista, tpls] = await Promise.all([listarAssets(), listarModelos()]);
        if (!vivo) return;
        setAssets(lista);
        if (tpls.length) setModelos(tpls);
      } catch {
        /* sem ficheiros ou sem rede: o editor continua a funcionar */
      }

      // URLs assinados expiram — renova os que já não servem.
      try {
        const renovadas = await renovarImagens(projeto.pages);
        if (!vivo) return;
        const mudou = JSON.stringify(renovadas) !== JSON.stringify(projeto.pages);
        if (mudou) ed.substituirPaginas(renovadas);
      } catch {
        /* ignora */
      }
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projeto.id]);

  // ------------------------------------------- preferências + rascunho local
  useEffect(() => {
    let vivo = true;
    limparRascunhosAntigos();

    (async () => {
      try {
        const p = await obterPreferencias();
        if (vivo) setPrefs(p);
      } catch {
        /* sem preferências: usa os valores por omissão */
      }

      const guardadoLocal = lerRascunho(projeto.id);
      if (
        vivo &&
        guardadoLocal &&
        conteudoDiferente(guardadoLocal.paginas, guardadoLocal.titulo, projeto.pages, projeto.title)
      ) {
        setRascunhoPendente(guardadoLocal);
      }
      rascunhoAtivo.current = true;
    })();

    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projeto.id]);

  // Espelha cada alteração no dispositivo. É a rede de segurança para quando o
  // autosave falha (sem ligação, sessão expirada, servidor em baixo).
  useEffect(() => {
    if (!rascunhoAtivo.current || rascunhoPendente) return;
    const t = setTimeout(() => {
      const ok = guardarRascunho({
        projectId: projeto.id,
        titulo,
        paginas: ed.paginas,
        versaoBase: versao.current,
        em: Date.now(),
      });
      if (ok) setTemRascunho(true);
    }, 700);
    return () => clearTimeout(t);
  }, [ed.paginas, titulo, projeto.id, rascunhoPendente]);

  // ------------------------------------------------------------- miniatura
  const gerarMiniatura = useCallback(async (): Promise<string | null> => {
    const node = artboardRef.current;
    if (!node) return null;
    const agora = Date.now();
    if (ultimoThumb.current.url && agora - ultimoThumb.current.em < 8000) {
      return ultimoThumb.current.url;
    }
    try {
      const url = await capturar(node, { mime: "jpeg", escala: 0.28, qualidade: 0.72 });
      ultimoThumb.current = { url, em: agora };
      return url;
    } catch {
      return ultimoThumb.current.url || null;
    }
  }, []);

  // ------------------------------------------------------------------ guardar
  const salvarAgora = useCallback(async () => {
    if (salvando.current) {
      pendente.current = true;
      return;
    }
    salvando.current = true;
    setEstado({ tipo: "a-guardar" });

    try {
      const miniatura = await gerarMiniatura();
      const res = await guardarProjeto({
        id: projeto.id,
        pages: dadosRef.current.paginas,
        title: dadosRef.current.titulo,
        thumbnail: miniatura,
        expectedVersion: versao.current,
      });

      if (res.conflict) {
        setConflito({
          version: res.version,
          pages: res.pages ?? dadosRef.current.paginas,
          title: res.title ?? dadosRef.current.titulo,
        });
        setEstado({ tipo: "conflito" });
      } else {
        versao.current = res.version;
        setEstado({ tipo: "guardado", quando: new Date() });
        // O documento está na base de dados: o rascunho local já não é preciso.
        apagarRascunho(projeto.id);
        setTemRascunho(false);
      }
    } catch (e) {
      setEstado({ tipo: "erro", mensagem: e instanceof Error ? e.message : "Falha ao guardar" });
      // Sem rede o trabalho tem de sobreviver: grava já neste dispositivo.
      const ok = guardarRascunho({
        projectId: projeto.id,
        titulo: dadosRef.current.titulo,
        paginas: dadosRef.current.paginas,
        versaoBase: versao.current,
        em: Date.now(),
      });
      if (ok) setTemRascunho(true);
    } finally {
      salvando.current = false;
      if (pendente.current) {
        pendente.current = false;
        setTimeout(() => void salvarAgora(), 400);
      }
    }
  }, [gerarMiniatura, projeto.id]);

  // Autosave
  useEffect(() => {
    if (primeiroRender.current) {
      primeiroRender.current = false;
      return;
    }
    const t = setTimeout(() => void salvarAgora(), 1300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ed.paginas, titulo]);

  // Aviso de saída com alterações por guardar
  useEffect(() => {
    const aoSair = (e: BeforeUnloadEvent) => {
      if (estado.tipo === "a-guardar" || estado.tipo === "erro") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", aoSair);
    return () => window.removeEventListener("beforeunload", aoSair);
  }, [estado.tipo]);

  // ------------------------------------------------------------- atalhos
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      const emCampo =
        alvo &&
        (alvo.tagName === "INPUT" ||
          alvo.tagName === "TEXTAREA" ||
          alvo.tagName === "SELECT" ||
          alvo.isContentEditable);

      const meta = e.ctrlKey || e.metaKey;

      if (meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void salvarAgora();
        return;
      }
      if (emCampo) return;

      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? ed.refazer() : ed.desfazer();
        return;
      }
      if (meta && e.key.toLowerCase() === "y") {
        e.preventDefault();
        ed.refazer();
        return;
      }
      if (meta && e.key.toLowerCase() === "d") {
        e.preventDefault();
        ed.duplicarSelecionados();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (ed.selecao.length) {
          e.preventDefault();
          ed.removerSelecionados();
        }
        return;
      }
      if (e.key === "Escape") {
        ed.selecionar([]);
        return;
      }
      if (e.key.startsWith("Arrow") && ed.selecao.length) {
        e.preventDefault();
        const passo = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -passo : e.key === "ArrowRight" ? passo : 0;
        const dy = e.key === "ArrowUp" ? -passo : e.key === "ArrowDown" ? passo : 0;
        ed.setPaginas(
          (paginas) =>
            paginas.map((p, i) =>
              i !== ed.atual
                ? p
                : {
                    ...p,
                    elements: p.elements.map((el) =>
                      ed.selecao.includes(el.id) ? { ...el, x: el.x + dx, y: el.y + dy } : el
                    ),
                  }
            ),
          true
        );
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [ed, salvarAgora]);

  // ------------------------------------------------------------- imagens
  const aoCarregarAsset = useCallback(async (file: File) => {
    setACarregarAsset(true);
    setAviso(null);
    try {
      const asset = await carregarAsset(file);
      setAssets((prev) => [asset, ...prev]);
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "Falha ao carregar a imagem.");
    } finally {
      setACarregarAsset(false);
    }
  }, []);

  const aoApagarAsset = useCallback(async (asset: DesignAsset) => {
    try {
      await apagarAsset(asset);
      setAssets((prev) => prev.filter((a) => a.id !== asset.id));
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "Falha ao apagar.");
    }
  }, []);

  // ------------------------------------------------------------- conflito
  const resolverConflito = useCallback(
    (modo: "servidor" | "copia" | "continuar") => {
      if (!conflito) return;
      if (modo === "servidor") {
        ed.substituirPaginas(conflito.pages);
        setTitulo(conflito.title);
        versao.current = conflito.version;
      } else if (modo === "copia") {
        void (async () => {
          try {
            const novo = await criarProjeto({
              title: `${titulo} (cópia local)`,
              formatKey: projeto.format_key,
              width: projeto.width,
              height: projeto.height,
              pages: dadosRef.current.paginas,
            });
            router.push(`/designer/${novo.id}`);
          } catch (e) {
            setAviso(e instanceof Error ? e.message : "Não foi possível criar a cópia.");
          }
        })();
        return;
      } else {
        versao.current = conflito.version;
      }
      setConflito(null);
      setEstado({ tipo: "pronto" });
    },
    [conflito, ed, projeto.format_key, projeto.height, projeto.width, router, titulo]
  );

  // ------------------------------------------------------------- exportar
  const exportar = useCallback(
    async ({
      formato,
      escala,
      todas,
    }: {
      formato: FormatoExportacao;
      escala: number;
      todas: boolean;
    }) => {
      setAExportar(true);
      setErroExport(null);

      const alvo = todas ? ed.paginas : [ed.pagina];
      setPaginasExport(alvo);

      try {
        await esperarPintura();
        await esperarPintura();

        const base = nomeSeguro(titulo, formato === "jpeg" ? "jpg" : formato);
        const fontEmbedCSS = artboardRef.current
          ? await prepararFontes(artboardRef.current)
          : undefined;

        const nos = Array.from(
          document.querySelectorAll<HTMLElement>("[data-export-page]")
        );

        if (nos.length !== alvo.length) {
          throw new Error("A preparar as páginas falhou. Tente novamente.");
        }

        if (formato === "pdf") {
          const paginasPdf: PaginaPdf[] = [];
          for (const no of nos) {
            const jpegUrl = await capturar(no, {
              mime: "jpeg",
              escala,
              qualidade: 0.92,
              fontEmbedCSS,
            });
            paginasPdf.push(
              paginaPdfDeJpeg(dataUrlParaBytes(jpegUrl), projeto.width, projeto.height, escala)
            );
          }
          const blob = construirPdf(paginasPdf);
          const partilhou = await partilharFicheiro(blob, base, titulo);
          if (!partilhou) descarregarBlob(blob, base);
        } else {
          const ficheiros: { url: string; nome: string }[] = [];
          for (let i = 0; i < nos.length; i++) {
            const url = await capturar(nos[i], {
              mime: formato === "jpeg" ? "jpeg" : "png",
              escala,
              qualidade: 0.95,
              fontEmbedCSS,
            });
            const ext = formato === "jpeg" ? "jpg" : "png";
            const nome =
              nos.length > 1
                ? base.replace(/\.(png|jpg|pdf)$/, `-${i + 1}.${ext}`)
                : base.replace(/\.(png|jpg|pdf)$/, `.${ext}`);
            ficheiros.push({ url, nome });
          }

          let partilhado = false;
          if (ficheiros.length === 1) {
            const blob = await (await fetch(ficheiros[0].url)).blob();
            partilhado = await partilharFicheiro(blob, ficheiros[0].nome, titulo);
            if (!partilhado) descarregar(ficheiros[0].url, ficheiros[0].nome);
          } else {
            for (const f of ficheiros) descarregar(f.url, f.nome);
          }
          void partilhado;
        }

        setDialogoExportar(false);
      } catch (e) {
        setErroExport(e instanceof Error ? e.message : "Falha na exportação.");
      } finally {
        setPaginasExport(null);
        setAExportar(false);
      }
    },
    [ed.pagina, ed.paginas, projeto.height, projeto.width, titulo]
  );

  // ------------------------------------------------------------- publicar
  const publicar = useCallback(async () => {
    try {
      await publicarModelo(projeto.id, titulo, "geral");
      const tpls = await listarModelos();
      setModelos(tpls);
      setAviso("Modelo publicado. Já aparece na galeria dos clientes.");
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "Não foi possível publicar.");
    }
  }, [projeto.id, titulo]);

  // ------------------------------------------------- publicar como conteúdo
  // Captura a página tal como está no ecrã (não a versão guardada), para o
  // cartaz publicado ser exatamente o que o gestor vê.
  const publicarComoConteudo = useCallback(
    async (entrada: Omit<EntradaPublicacao, "imagem">) => {
      setAPublicar(true);
      setErroPublicar(null);

      try {
        const node = artboardRef.current;
        if (!node) throw new Error("A página ainda não está pronta. Tente novamente.");

        const imagem = await capturar(node, { mime: "jpeg", escala: 1, qualidade: 0.9 });

        const res = await publicarConteudo({
          ...entrada,
          project_id: projeto.id,
          imagem,
        });

        setPublicado({ id: res.id, status: entrada.status });
        setDialogoPublicar(false);

        const destino = TIPOS.find((t) => t.key === entrada.kind);
        setAviso(
          entrada.status === "publicado"
            ? `Publicado em ${destino?.label ?? entrada.kind}. Já está visível no destino.`
            : "Guardado como rascunho. Pode publicá-lo na gestão de conteúdos."
        );
      } catch (e) {
        setErroPublicar(e instanceof Error ? e.message : "Não foi possível publicar.");
      } finally {
        setAPublicar(false);
      }
    },
    [projeto.id]
  );

  const abrirPublicar = useCallback(async () => {
    setErroPublicar(null);
    setDialogoPublicar(true);
    const url = await gerarMiniatura();
    setMiniaturaPublicar(url);
  }, [gerarMiniatura]);

  const apagar = useCallback(async () => {
    if (!window.confirm("Apagar este projeto definitivamente? Não é possível recuperar.")) return;
    try {
      await apagarProjeto(projeto.id);
      router.push("/designer");
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "Não foi possível apagar.");
    }
  }, [projeto.id, router]);

  const duplicarAgora = useCallback(async () => {
    try {
      const novo = await duplicarProjeto(projeto.id);
      router.push(`/designer/${novo}`);
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "Não foi possível duplicar.");
    }
  }, [projeto.id, router]);

  // ------------------------------------------------------------- rascunho
  const recuperarRascunho = useCallback(() => {
    if (!rascunhoPendente) return;
    ed.substituirPaginas(rascunhoPendente.paginas);
    setTitulo(rascunhoPendente.titulo);
    setRascunhoPendente(null);
    setTemRascunho(true);
    setAviso(
      "Alterações recuperadas deste dispositivo. Ainda não estão no servidor — o autosave vai enviá-las."
    );
  }, [ed, rascunhoPendente]);

  const descartarRascunho = useCallback(() => {
    apagarRascunho(projeto.id);
    setRascunhoPendente(null);
    setTemRascunho(false);
  }, [projeto.id]);

  // ------------------------------------------------------------- histórico
  const abrirHistorico = useCallback(async () => {
    setHistorico(true);
    setErroHistorico(null);
    setACarregarVersoes(true);
    try {
      setVersoes(await listarVersoes(projeto.id));
    } catch (e) {
      setErroHistorico(e instanceof Error ? e.message : "Não foi possível ler o histórico.");
      setVersoes([]);
    } finally {
      setACarregarVersoes(false);
    }
  }, [projeto.id]);

  const guardarSnapshot = useCallback(
    async (etiqueta: string) => {
      setAProcessarVersao(true);
      setErroHistorico(null);
      try {
        // Guarda primeiro para o instantâneo refletir o que está no ecrã.
        await salvarAgora();
        await criarSnapshot(projeto.id, etiqueta || null);
        setVersoes(await listarVersoes(projeto.id));
      } catch (e) {
        setErroHistorico(e instanceof Error ? e.message : "Não foi possível guardar a versão.");
      } finally {
        setAProcessarVersao(false);
      }
    },
    [projeto.id, salvarAgora]
  );

  const restaurar = useCallback(
    async (versionId: string) => {
      setAProcessarVersao(true);
      setErroHistorico(null);
      try {
        const res = await restaurarVersao(projeto.id, versionId);
        ed.substituirPaginas(res.pages);
        setTitulo(res.title);
        versao.current = res.version;
        apagarRascunho(projeto.id);
        setTemRascunho(false);
        setEstado({ tipo: "guardado", quando: new Date() });
        setHistorico(false);
        setAviso(`Versão ${res.restaurado_de} restaurada. Já está guardada no servidor.`);
      } catch (e) {
        setErroHistorico(e instanceof Error ? e.message : "Não foi possível restaurar.");
      } finally {
        setAProcessarVersao(false);
      }
    },
    [ed, projeto.id]
  );

  // ------------------------------------------- províncias + publicação existente
  useEffect(() => {
    let vivo = true;
    (async () => {
      const supabase = createClientBrowser();
      const provs = await listarProvincias(supabase);
      if (vivo) setProvincias(provs);

      // Um projeto só pode estar publicado uma vez — saber isto permite ao
      // diálogo dizer "atualizar" em vez de "publicar" e não duplicar.
      const { data } = await supabase
        .from("content_items")
        .select("id, status")
        .eq("project_id", projeto.id)
        .maybeSingle();
      if (vivo && data) {
        setPublicado({ id: data.id, status: data.status as EstadoConteudo });
      }
    })();
    return () => {
      vivo = false;
    };
  }, [projeto.id]);

  // ------------------------------------------------------------- preferências
  const alternarSnap = useCallback(() => {
    setPrefs((p) => {
      const novo = { ...p, snap_enabled: !p.snap_enabled };
      void guardarPreferencias({ snap_enabled: novo.snap_enabled }).catch(() => undefined);
      return novo;
    });
  }, []);

  // Lembra a última fonte usada num texto, para o próximo texto já nascer nela.
  useEffect(() => {
    const alvo = ed.selecionados.find((e) => e.type === "text");
    if (!alvo || alvo.type !== "text") return;
    if (alvo.fontFamily === prefs.last_font) return;
    const t = setTimeout(() => {
      setPrefs((p) => ({ ...p, last_font: alvo.fontFamily }));
      void guardarPreferencias({ last_font: alvo.fontFamily }).catch(() => undefined);
    }, 2000);
    return () => clearTimeout(t);
  }, [ed.selecionados, prefs.last_font]);

  // ------------------------------------------------------------- painéis
  const painel = useMemo(() => {
    switch (aba) {
      case "texto":
        return <TextoPanel editor={ed} fontePreferida={prefs.last_font} />;
      case "imagens":
        return (
          <ImagensPanel
            editor={ed}
            assets={assets}
            aCarregar={aCarregarAsset}
            onCarregar={aoCarregarAsset}
            onApagar={aoApagarAsset}
            largura={projeto.width}
            altura={projeto.height}
            onAbrirCatalogo={() => {
              setAba("catalogo");
              setSheet("catalogo");
            }}
          />
        );
      case "catalogo":
        return <CatalogoPanel editor={ed} largura={projeto.width} altura={projeto.height} />;
      case "formas":
        return <FormasPanel editor={ed} />;
      case "fundo":
        return <FundoPanel editor={ed} />;
      case "camadas":
        return <CamadasPanel editor={ed} />;
      case "paginas":
        return <PaginasPanel editor={ed} largura={projeto.width} altura={projeto.height} />;
      case "modelos":
        return <ModelosPanel editor={ed} modelos={modelos} />;
      case "propriedades":
        return <PropertiesPanel editor={ed} />;
    }
  }, [aba, aoApagarAsset, aoCarregarAsset, aCarregarAsset, assets, ed, modelos, projeto.height, projeto.width]);

  const tituloAba = FERRAMENTAS.find((f) => f.key === (sheet ?? aba))?.label ?? "";

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#0A0A0A] text-[#F5F5F5]">
      <TopBar
        titulo={titulo}
        onTitulo={setTitulo}
        formato={`${projeto.format_key} · ${projeto.width}×${projeto.height}`}
        podeDesfazer={ed.podeDesfazer}
        podeRefazer={ed.podeRefazer}
        onDesfazer={ed.desfazer}
        onRefazer={ed.refazer}
        estado={estado}
        onGuardar={() => void salvarAgora()}
        onPrevisualizar={() => setPreview(true)}
        onExportar={() => setDialogoExportar(true)}
        zoom={zoom}
        onZoom={(z) => setZoom(Math.max(0.05, Math.min(4, z)))}
        onAjustar={() => {
          setZoom(0.5);
          setPan({ x: 0, y: 0 });
        }}
        onDuplicar={() => void duplicarAgora()}
        onApagar={() => void apagar()}
        onPublicar={() => void publicar()}
        onPublicarConteudo={() => void abrirPublicar()}
        podePublicar={podePublicar}
        onHistorico={() => void abrirHistorico()}
        rascunho={temRascunho}
      />

      {rascunhoPendente && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[#2A2418] bg-[#1D1A12] px-4 py-2">
          <p className="min-w-0 flex-1 text-xs text-[#E5C98A]">
            Há alterações guardadas neste dispositivo que não chegaram ao servidor (
            {new Date(rascunhoPendente.em).toLocaleString("pt-PT", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
            ). Recuperar?
          </p>
          <button
            type="button"
            onClick={recuperarRascunho}
            className="rounded bg-[#C9A962] px-2.5 py-1 text-[11px] font-semibold text-[#0A0A0A]"
          >
            Recuperar
          </button>
          <button
            type="button"
            onClick={descartarRascunho}
            className="rounded border border-[#3A3222] px-2.5 py-1 text-[11px] text-[#C9A962]"
          >
            Descartar
          </button>
        </div>
      )}

      {conflito && (
        <ConflitoBanner
          onRecarregar={() => resolverConflito("servidor")}
          onDuplicar={() => resolverConflito("copia")}
          onIgnorar={() => resolverConflito("continuar")}
        />
      )}

      {aviso && (
        <div className="flex items-center gap-3 border-b border-[#1F1F1F] bg-[#141414] px-4 py-2">
          <p className="min-w-0 flex-1 text-xs text-[#D4D4D4]">{aviso}</p>
          <button
            type="button"
            onClick={() => setAviso(null)}
            className="text-[11px] text-[#8A8A8A] hover:text-white"
          >
            fechar
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Rail de ferramentas — desktop */}
        <nav className="hidden w-[68px] shrink-0 flex-col items-center gap-1 border-r border-[#1F1F1F] bg-[#0D0D0D] py-2 lg:flex">
          {FERRAMENTAS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setAba(key)}
              title={label}
              className={`flex w-14 flex-col items-center gap-1 rounded-lg py-2 text-[10px] transition ${
                aba === key
                  ? "bg-[#1D1A12] text-[#C9A962]"
                  : "text-[#8A8A8A] hover:bg-[#161616] hover:text-[#E5E5E5]"
              }`}
            >
              <Icon className="h-4.5 w-4.5" />
              {label}
            </button>
          ))}

          {podePublicar && (
            <button
              type="button"
              onClick={() => void publicar()}
              className="mt-auto w-14 rounded-lg py-2 text-[10px] text-[#6F6F6F] hover:text-[#C9A962]"
              title="Publicar como modelo para os clientes"
            >
              Publicar
            </button>
          )}
        </nav>

        {/* Painel — desktop */}
        <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-r border-[#1F1F1F] bg-[#0D0D0D] lg:block">
          <div className="border-b border-[#1F1F1F] px-4 py-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#C9A962]">
              {FERRAMENTAS.find((f) => f.key === aba)?.label}
            </h2>
          </div>
          {painel}
        </aside>

        <CanvasStage
          editor={ed}
          largura={projeto.width}
          altura={projeto.height}
          artboardRef={artboardRef}
          zoom={zoom}
          setZoom={setZoom}
          pan={pan}
          setPan={setPan}
          snapAtivo={prefs.snap_enabled}
          onToggleSnap={alternarSnap}
        />

        {/* Propriedades — desktop largo */}
        <aside className="hidden w-[286px] shrink-0 overflow-y-auto border-l border-[#1F1F1F] bg-[#0D0D0D] xl:block">
          <div className="border-b border-[#1F1F1F] px-4 py-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#C9A962]">
              Propriedades
            </h2>
          </div>
          <PropertiesPanel editor={ed} />
        </aside>
      </div>

      {/* Barra inferior — mobile */}
      <nav className="flex shrink-0 items-stretch justify-around border-t border-[#1F1F1F] bg-[#0D0D0D] pb-[env(safe-area-inset-bottom)] lg:hidden">
        {FERRAMENTAS.filter((f) => f.mobile).map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setSheet(key)}
            className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] text-[#8A8A8A] active:bg-[#161616]"
          >
            <Icon className="h-5 w-5" />
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setSheet("propriedades")}
          className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] text-[#8A8A8A] active:bg-[#161616]"
        >
          <SlidersHorizontal className="h-5 w-5" />
          Editar
        </button>
      </nav>

      <Sheet aberto={sheet !== null} titulo={tituloAba} onFechar={() => setSheet(null)}>
        {sheet && (
          <div onClick={(e) => e.stopPropagation()}>
            {sheet === "texto" && <TextoPanel editor={ed} fontePreferida={prefs.last_font} />}
            {sheet === "imagens" && (
              <ImagensPanel
                editor={ed}
                assets={assets}
                aCarregar={aCarregarAsset}
                onCarregar={aoCarregarAsset}
                onApagar={aoApagarAsset}
                largura={projeto.width}
                altura={projeto.height}
                onAbrirCatalogo={() => setSheet("catalogo")}
              />
            )}
            {sheet === "catalogo" && (
              <CatalogoPanel editor={ed} largura={projeto.width} altura={projeto.height} />
            )}
            {sheet === "formas" && <FormasPanel editor={ed} />}
            {sheet === "fundo" && <FundoPanel editor={ed} />}
            {sheet === "camadas" && <CamadasPanel editor={ed} />}
            {sheet === "paginas" && (
              <PaginasPanel editor={ed} largura={projeto.width} altura={projeto.height} />
            )}
            {sheet === "propriedades" && <PropertiesPanel editor={ed} />}
          </div>
        )}
      </Sheet>

      <PreviewModal
        aberto={preview}
        onFechar={() => setPreview(false)}
        pagina={ed.pagina}
        largura={projeto.width}
        altura={projeto.height}
        titulo={titulo}
      />

      <PublicarDialog
        aberto={dialogoPublicar}
        onFechar={() => setDialogoPublicar(false)}
        onPublicar={(entrada) => void publicarComoConteudo(entrada)}
        aPublicar={aPublicar}
        erro={erroPublicar}
        miniatura={miniaturaPublicar}
        provincias={provincias}
        existente={publicado}
        tituloProjeto={titulo}
      />

      <ExportDialog
        aberto={dialogoExportar}
        onFechar={() => setDialogoExportar(false)}
        onExportar={exportar}
        aExportar={aExportar}
        numPaginas={ed.paginas.length}
        largura={projeto.width}
        altura={projeto.height}
        erro={erroExport}
        podePartilhar={typeof navigator !== "undefined" && "share" in navigator}
      />

      <HistoricoDialog
        aberto={historico}
        onFechar={() => setHistorico(false)}
        versoes={versoes}
        aCarregar={aCarregarVersoes}
        aProcessar={aProcessarVersao}
        erro={erroHistorico}
        versaoAtual={versao.current}
        onRestaurar={(id) => void restaurar(id)}
        onSnapshot={(etiqueta) => void guardarSnapshot(etiqueta)}
      />

      {/* Camada de exportação: fora do ecrã, mas com o tamanho real */}
      {paginasExport && (
        <div
          aria-hidden
          style={{ position: "fixed", left: -30000, top: 0, zIndex: -1, opacity: 1 }}
        >
          {paginasExport.map((p) => (
            <div
              key={p.id}
              data-export-page
              style={{
                position: "relative",
                width: projeto.width,
                height: projeto.height,
                overflow: "hidden",
                ...estiloFundo(p.background),
              }}
            >
              {p.elements.map((el) => (
                <ElementView key={el.id} el={el} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
