"use client";

import type { DesignPage } from "./types";

/**
 * Rascunho local.
 *
 * O autosave depende da rede. Se a ligação cair a meio de um trabalho, o
 * documento do servidor fica atrasado e o cliente perderia tudo ao fechar o
 * separador. Por isso cada alteração é espelhada no `localStorage`, com a
 * versão do servidor em que se baseou. Ao reabrir, o editor compara e oferece
 * a recuperação — nunca a aplica sozinho, porque pode ser mais antiga do que
 * o que está no servidor noutro dispositivo.
 *
 * Isto não substitui a base de dados: um projeto só conta como guardado
 * depois de `design_save` responder sem conflito.
 */

const PREFIXO = "inuka:designer:rascunho:";
const VALIDADE_MS = 1000 * 60 * 60 * 24 * 14; // 14 dias

export interface Rascunho {
  projectId: string;
  titulo: string;
  paginas: DesignPage[];
  /** Versão do servidor sobre a qual este rascunho foi construído. */
  versaoBase: number;
  /** Momento local da última alteração. */
  em: number;
}

function chave(projectId: string): string {
  return `${PREFIXO}${projectId}`;
}

export function guardarRascunho(r: Rascunho): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(chave(r.projectId), JSON.stringify(r));
    return true;
  } catch {
    // Quota cheia ou modo privado: o autosave continua a ser a via principal.
    return false;
  }
}

export function lerRascunho(projectId: string): Rascunho | null {
  if (typeof window === "undefined") return null;
  try {
    const bruto = window.localStorage.getItem(chave(projectId));
    if (!bruto) return null;
    const r = JSON.parse(bruto) as Rascunho;
    if (!r || r.projectId !== projectId || !Array.isArray(r.paginas)) return null;
    if (!r.em || Date.now() - r.em > VALIDADE_MS) {
      apagarRascunho(projectId);
      return null;
    }
    return r;
  } catch {
    return null;
  }
}

export function apagarRascunho(projectId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(chave(projectId));
  } catch {
    /* ignora */
  }
}

/** Compara o conteúdo, não o objeto: qualquer alteração real conta. */
export function conteudoDiferente(
  paginas: DesignPage[],
  titulo: string,
  outraPaginas: DesignPage[],
  outroTitulo: string
): boolean {
  if (titulo !== outroTitulo) return true;
  try {
    return JSON.stringify(paginas) !== JSON.stringify(outraPaginas);
  } catch {
    return true;
  }
}

/** Limpa rascunhos antigos de outros projetos, para não crescer sem limite. */
export function limparRascunhosAntigos(): void {
  if (typeof window === "undefined") return;
  try {
    const agora = Date.now();
    const remover: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith(PREFIXO)) continue;
      const bruto = window.localStorage.getItem(k);
      if (!bruto) continue;
      try {
        const r = JSON.parse(bruto) as Rascunho;
        if (!r.em || agora - r.em > VALIDADE_MS) remover.push(k);
      } catch {
        remover.push(k);
      }
    }
    remover.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* ignora */
  }
}
