"use client";

import { useCallback, useMemo, useReducer, useRef } from "react";
import { duplicarElemento, novaPagina, type DesignElement, type DesignPage } from "./types";

/**
 * Estado do editor + pilha de desfazer/refazer.
 *
 * Só as páginas entram no histórico. A seleção e a página ativa ficam de fora,
 * senão desfazer mudava o que está selecionado, o que é desorientador.
 *
 * Operações contínuas (arrastar, redimensionar) abrem uma "transação": o
 * instantâneo é tirado uma única vez no primeiro movimento, para que um arrasto
 * de 200 píxeis seja um só passo de desfazer e não duzentos.
 */

const LIMITE_HISTORICO = 80;

interface Estado {
  paginas: DesignPage[];
  atual: number;
  selecao: string[];
  undo: DesignPage[][];
  redo: DesignPage[][];
}

type Acao =
  | { tipo: "carregar"; paginas: DesignPage[] }
  | { tipo: "marcar" }
  | { tipo: "aplicar"; updater: (p: DesignPage[]) => DesignPage[]; commit: boolean }
  | { tipo: "desfazer" }
  | { tipo: "refazer" }
  | { tipo: "selecionar"; ids: string[] }
  | { tipo: "paginaAtual"; indice: number };

function inicial(paginas: DesignPage[]): Estado {
  return { paginas, atual: 0, selecao: [], undo: [], redo: [] };
}

function reducer(estado: Estado, acao: Acao): Estado {
  switch (acao.tipo) {
    case "carregar":
      return inicial(acao.paginas);

    case "marcar":
      // Instantâneo explícito no início de um gesto contínuo.
      return {
        ...estado,
        undo: [...estado.undo, estado.paginas].slice(-LIMITE_HISTORICO),
        redo: [],
      };

    case "aplicar": {
      const paginas = acao.updater(estado.paginas);
      if (paginas === estado.paginas) return estado;

      const undo = acao.commit
        ? [...estado.undo, estado.paginas].slice(-LIMITE_HISTORICO)
        : estado.undo;

      // Se a página atual deixou de existir, recua para a última válida.
      const atual = Math.min(estado.atual, Math.max(0, paginas.length - 1));
      const idsValidos = new Set(paginas[atual]?.elements.map((e) => e.id) ?? []);

      return {
        ...estado,
        paginas,
        atual,
        selecao: estado.selecao.filter((id) => idsValidos.has(id)),
        undo,
        redo: acao.commit ? [] : estado.redo,
      };
    }

    case "desfazer": {
      if (estado.undo.length === 0) return estado;
      const anterior = estado.undo[estado.undo.length - 1];
      return {
        ...estado,
        paginas: anterior,
        undo: estado.undo.slice(0, -1),
        redo: [...estado.redo, estado.paginas],
        atual: Math.min(estado.atual, Math.max(0, anterior.length - 1)),
        selecao: [],
      };
    }

    case "refazer": {
      if (estado.redo.length === 0) return estado;
      const seguinte = estado.redo[estado.redo.length - 1];
      return {
        ...estado,
        paginas: seguinte,
        redo: estado.redo.slice(0, -1),
        undo: [...estado.undo, estado.paginas],
        atual: Math.min(estado.atual, Math.max(0, seguinte.length - 1)),
        selecao: [],
      };
    }

    case "selecionar":
      return { ...estado, selecao: acao.ids };

    case "paginaAtual":
      return {
        ...estado,
        atual: Math.min(Math.max(0, acao.indice), estado.paginas.length - 1),
        selecao: [],
      };

    default:
      return estado;
  }
}

export function useEditor(paginasIniciais: DesignPage[]) {
  const [estado, dispatch] = useReducer(reducer, paginasIniciais, inicial);

  const emTransacao = useRef(false);
  const paginasRef = useRef(estado.paginas);
  paginasRef.current = estado.paginas;

  const setPaginas = useCallback(
    (updater: (p: DesignPage[]) => DesignPage[], commit = true) => {
      dispatch({ tipo: "aplicar", updater, commit });
    },
    []
  );

  /** Marca o início de um gesto contínuo (só se ainda não estiver aberto). */
  const iniciarTransacao = useCallback(() => {
    if (emTransacao.current) return;
    emTransacao.current = true;
    dispatch({ tipo: "marcar" });
  }, []);

  const terminarTransacao = useCallback(() => {
    emTransacao.current = false;
  }, []);

  const aplicarContinuo = useCallback(
    (updater: (p: DesignPage[]) => DesignPage[]) => {
      dispatch({ tipo: "aplicar", updater, commit: false });
    },
    []
  );

  const pagina = estado.paginas[estado.atual] ?? estado.paginas[0];
  const selecionados = useMemo(
    () => pagina?.elements.filter((e) => estado.selecao.includes(e.id)) ?? [],
    [pagina, estado.selecao]
  );

  // -- elementos -------------------------------------------------------------

  const atualizarElemento = useCallback(
    (id: string, patch: Partial<DesignElement>, commit = true) => {
      setPaginas(
        (paginas) =>
          paginas.map((p, i) =>
            i !== estado.atual
              ? p
              : {
                  ...p,
                  elements: p.elements.map((el) =>
                    el.id === id ? ({ ...el, ...patch } as DesignElement) : el
                  ),
                }
          ),
        commit
      );
    },
    [estado.atual, setPaginas]
  );

  const atualizarSelecionados = useCallback(
    (patch: Partial<DesignElement>, commit = true) => {
      const ids = new Set(estado.selecao);
      if (ids.size === 0) return;
      setPaginas(
        (paginas) =>
          paginas.map((p, i) =>
            i !== estado.atual
              ? p
              : {
                  ...p,
                  elements: p.elements.map((el) =>
                    ids.has(el.id) ? ({ ...el, ...patch } as DesignElement) : el
                  ),
                }
          ),
        commit
      );
    },
    [estado.atual, estado.selecao, setPaginas]
  );

  const adicionarElemento = useCallback(
    (el: DesignElement) => {
      setPaginas(
        (paginas) =>
          paginas.map((p, i) => (i !== estado.atual ? p : { ...p, elements: [...p.elements, el] })),
        true
      );
      dispatch({ tipo: "selecionar", ids: [el.id] });
    },
    [estado.atual, setPaginas]
  );

  const removerSelecionados = useCallback(() => {
    const ids = new Set(estado.selecao);
    if (ids.size === 0) return;
    setPaginas(
      (paginas) =>
        paginas.map((p, i) =>
          i !== estado.atual ? p : { ...p, elements: p.elements.filter((el) => !ids.has(el.id)) }
        ),
      true
    );
    dispatch({ tipo: "selecionar", ids: [] });
  }, [estado.atual, estado.selecao, setPaginas]);

  const duplicarSelecionados = useCallback(() => {
    const alvos = pagina?.elements.filter((e) => estado.selecao.includes(e.id)) ?? [];
    if (alvos.length === 0) return;
    const copias = alvos.map((e) => duplicarElemento(e));
    setPaginas(
      (paginas) =>
        paginas.map((p, i) =>
          i !== estado.atual ? p : { ...p, elements: [...p.elements, ...copias] }
        ),
      true
    );
    dispatch({ tipo: "selecionar", ids: copias.map((c) => c.id) });
  }, [estado.atual, estado.selecao, pagina, setPaginas]);

  const moverOrdem = useCallback(
    (id: string, direcao: "frente" | "tras" | "topo" | "fundo") => {
      setPaginas(
        (paginas) =>
          paginas.map((p, i) => {
            if (i !== estado.atual) return p;
            const idx = p.elements.findIndex((e) => e.id === id);
            if (idx < 0) return p;
            const lista = [...p.elements];
            const [el] = lista.splice(idx, 1);
            const destino =
              direcao === "frente"
                ? Math.min(lista.length, idx + 1)
                : direcao === "tras"
                  ? Math.max(0, idx - 1)
                  : direcao === "topo"
                    ? lista.length
                    : 0;
            lista.splice(destino, 0, el);
            return { ...p, elements: lista };
          }),
        true
      );
    },
    [estado.atual, setPaginas]
  );

  // -- páginas ---------------------------------------------------------------

  const adicionarPagina = useCallback(() => {
    const modelo = pagina;
    const nova = novaPagina(`Página ${estado.paginas.length + 1}`, modelo?.background);
    setPaginas((paginas) => [...paginas, nova], true);
    dispatch({ tipo: "paginaAtual", indice: estado.paginas.length });
  }, [estado.paginas.length, pagina, setPaginas]);

  const duplicarPagina = useCallback(
    (indice: number) => {
      const origem = estado.paginas[indice];
      if (!origem) return;
      const copia: DesignPage = {
        ...origem,
        id: crypto.randomUUID(),
        name: `${origem.name} (cópia)`,
        background: { ...origem.background },
        elements: origem.elements.map((e) => duplicarElemento(e, 0)),
      };
      setPaginas((paginas) => {
        const lista = [...paginas];
        lista.splice(indice + 1, 0, copia);
        return lista;
      }, true);
      dispatch({ tipo: "paginaAtual", indice: indice + 1 });
    },
    [estado.paginas, setPaginas]
  );

  const removerPagina = useCallback(
    (indice: number) => {
      if (estado.paginas.length <= 1) return;
      setPaginas((paginas) => paginas.filter((_, i) => i !== indice), true);
      dispatch({ tipo: "paginaAtual", indice: Math.max(0, indice - 1) });
    },
    [estado.paginas.length, setPaginas]
  );

  const renomearPagina = useCallback(
    (indice: number, nome: string) => {
      setPaginas(
        (paginas) => paginas.map((p, i) => (i === indice ? { ...p, name: nome } : p)),
        true
      );
    },
    [setPaginas]
  );

  const definirFundo = useCallback(
    (background: DesignPage["background"], commit = true) => {
      setPaginas(
        (paginas) =>
          paginas.map((p, i) => (i !== estado.atual ? p : { ...p, background })),
        commit
      );
    },
    [estado.atual, setPaginas]
  );

  const substituirPaginas = useCallback(
    (paginas: DesignPage[]) => dispatch({ tipo: "carregar", paginas }),
    []
  );

  return {
    paginas: estado.paginas,
    atual: estado.atual,
    pagina,
    selecao: estado.selecao,
    selecionados,
    podeDesfazer: estado.undo.length > 0,
    podeRefazer: estado.redo.length > 0,

    setPaginas,
    iniciarTransacao,
    terminarTransacao,
    aplicarContinuo,

    atualizarElemento,
    atualizarSelecionados,
    adicionarElemento,
    removerSelecionados,
    duplicarSelecionados,
    moverOrdem,

    adicionarPagina,
    duplicarPagina,
    removerPagina,
    renomearPagina,
    definirFundo,
    substituirPaginas,

    selecionar: (ids: string[]) => dispatch({ tipo: "selecionar", ids }),
    irParaPagina: (indice: number) => dispatch({ tipo: "paginaAtual", indice }),
    desfazer: () => dispatch({ tipo: "desfazer" }),
    refazer: () => dispatch({ tipo: "refazer" }),
  };
}

export type Editor = ReturnType<typeof useEditor>;
