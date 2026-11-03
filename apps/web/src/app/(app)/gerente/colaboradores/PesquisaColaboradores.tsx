"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, SlidersHorizontal } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { formatCurrency } from "@/lib/utils";
import {
  numero,
  iniciais,
  mensagemErro,
  type ColaboradorPesquisa,
} from "@/lib/colaborador";
import type { Provincia } from "@/lib/provincias";
import TabelaResponsiva from "@/components/TabelaResponsiva";

/**
 * Pesquisa de colaboradores da gestão.
 *
 * A pesquisa corre na base de dados (`pesquisar_colaboradores`), não no
 * browser: um gestor provincial nunca recebe linhas de outra província, mesmo
 * que escreva o nome de alguém de lá.
 */
export default function PesquisaColaboradores({
  provincias,
  podeEscolherProvincia,
}: {
  provincias: Provincia[];
  podeEscolherProvincia: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [provincia, setProvincia] = useState("");
  const [municipio, setMunicipio] = useState("");
  const [estado, setEstado] = useState("");
  const [ordem, setOrdem] = useState("nome");
  const [linhas, setLinhas] = useState<ColaboradorPesquisa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const pesquisar = useCallback(async () => {
    setCarregando(true);
    setErro("");

    const supabase = createClientBrowser();
    const { data, error } = await supabase.rpc("pesquisar_colaboradores", {
      p_texto: texto.trim() || null,
      p_provincia: provincia || null,
      p_municipio: municipio.trim() || null,
      p_estado: estado || null,
      p_ordem: ordem,
    });

    setCarregando(false);

    if (error) {
      setErro(mensagemErro(error));
      setLinhas([]);
      return;
    }

    setLinhas((data ?? []) as ColaboradorPesquisa[]);
  }, [texto, provincia, municipio, estado, ordem]);

  // Espera 250 ms: escrever uma referência são 12 teclas, não 12 pedidos.
  useEffect(() => {
    const t = setTimeout(pesquisar, 250);
    return () => clearTimeout(t);
  }, [pesquisar]);

  const totais = useMemo(
    () => ({
      colaboradores: linhas.length,
      vendas: linhas.reduce((s, l) => s + numero(l.vendas_valor), 0),
      comissao: linhas.reduce((s, l) => s + numero(l.comissao_total), 0),
      pendente: linhas.reduce((s, l) => s + numero(l.comissao_pendente), 0),
    }),
    [linhas]
  );

  const filtrosAtivos = texto || provincia || municipio || estado || ordem !== "nome";

  return (
    <div>
      <div className="mb-4 rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#525252]" />
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Referência, nome, BI ou telefone…"
              className="w-full rounded-lg border border-[#333] bg-[#0A0A0A] py-2 pl-9 pr-3 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {podeEscolherProvincia && (
              <select
                value={provincia}
                onChange={(e) => setProvincia(e.target.value)}
                className={select}
                aria-label="Província"
              >
                <option value="">Todas as províncias</option>
                {provincias.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            )}

            <input
              value={municipio}
              onChange={(e) => setMunicipio(e.target.value)}
              placeholder="Município"
              className={`${select} w-32`}
              aria-label="Município"
            />

            <select
              value={estado}
              onChange={(e) => setEstado(e.target.value)}
              className={select}
              aria-label="Estado"
            >
              <option value="">Todos os estados</option>
              <option value="ativos">Ativos</option>
              <option value="inativos">Inativos</option>
            </select>

            <select
              value={ordem}
              onChange={(e) => setOrdem(e.target.value)}
              className={select}
              aria-label="Ordenar por"
            >
              <option value="nome">Nome</option>
              <option value="vendas">Maiores vendas</option>
              <option value="clientes">Mais clientes</option>
              <option value="comissao">Maiores comissões</option>
              <option value="meta">Metas atingidas</option>
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-[#6F6F6F]">
          <span className="inline-flex items-center gap-1">
            <SlidersHorizontal className="h-3 w-3" />
            {totais.colaboradores} {totais.colaboradores === 1 ? "resultado" : "resultados"}
          </span>
          <span>Vendido: {formatCurrency(totais.vendas)}</span>
          <span>Comissões: {formatCurrency(totais.comissao)}</span>
          <span className={totais.pendente > 0 ? "text-[#E3D5A7]" : ""}>
            Por pagar: {formatCurrency(totais.pendente)}
          </span>
          {filtrosAtivos && (
            <button
              type="button"
              onClick={() => {
                setTexto("");
                setProvincia("");
                setMunicipio("");
                setEstado("");
                setOrdem("nome");
              }}
              className="text-[#6F6F6F] underline-offset-2 transition hover:text-[#C9A962] hover:underline"
            >
              limpar filtros
            </button>
          )}
        </div>
      </div>

      {erro && (
        <div className="mb-4 rounded-lg border border-[#4A2020] bg-[#2A1010] p-3 text-sm text-[#F87171]">
          {erro}
        </div>
      )}

      {carregando && linhas.length === 0 ? (
        <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-10 text-center text-sm text-[#525252]">
          A carregar colaboradores…
        </div>
      ) : linhas.length === 0 ? (
        <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-10 text-center">
          <p className="text-[#A3A3A3]">Nenhum colaborador encontrado.</p>
          <p className="mt-2 text-sm text-[#525252]">
            {filtrosAtivos
              ? "Experimente limpar os filtros ou procurar por outro termo."
              : "Ainda não há colaboradores. Promova um cliente registado para começar."}
          </p>
        </div>
      ) : (
        <TabelaResponsiva
          itens={linhas}
          chaveDe={(l) => l.id}
          minimo={860}
          colunas={[
            {
              chave: "nome",
              rotulo: "Colaborador",
              titulo: true,
              celula: (l) => (
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#C9A962]/30 bg-[#0A0A0A]">
                    {l.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.avatar_url} alt={l.nome} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-[10px] text-[#C9A962]">{iniciais(l.nome)}</span>
                    )}
                  </span>
                  <div className="min-w-0">
                    <Link
                      href={`/gerente/colaboradores/${l.id}`}
                      className="text-[#F5F5F5] hover:text-[#C9A962]"
                    >
                      {l.nome}
                    </Link>
                    <p className="font-mono text-[10px] tracking-wider text-[#C9A962]">
                      {l.referencia ?? "sem referência"}
                    </p>
                    <p className="text-[10px] text-[#525252]">{l.phone ?? "sem telefone"}</p>
                  </div>
                </div>
              ),
            },
            {
              chave: "provincia",
              rotulo: "Província",
              celula: (l) => (
                <span className="text-[#A3A3A3]">
                  {l.provincia ?? "—"}
                  {l.municipio && <p className="text-[10px] text-[#525252]">{l.municipio}</p>}
                </span>
              ),
            },
            {
              chave: "funcao",
              rotulo: "Função",
              celula: (l) => (
                <span className="text-[#A3A3A3]">
                  {l.job_title ?? "—"}
                  {l.category && <p className="text-[10px] text-[#525252]">{l.category}</p>}
                </span>
              ),
            },
            {
              chave: "clientes",
              rotulo: "Clientes",
              alinhar: "direita",
              celula: (l) => (
                <span className="text-[#A3A3A3]">
                  {l.clientes}
                  <p className="text-[10px] text-[#525252]">{l.clientes_ativos} ativos</p>
                </span>
              ),
            },
            {
              chave: "vendido",
              rotulo: "Vendido",
              alinhar: "direita",
              celula: (l) => (
                <span className="text-[#C9A962]">
                  {formatCurrency(numero(l.vendas_valor))}
                  <p className="text-[10px] text-[#525252]">{l.vendas_count} vendas</p>
                </span>
              ),
            },
            {
              chave: "comissao",
              rotulo: "Comissão",
              alinhar: "direita",
              celula: (l) => (
                <span className="text-[#A3A3A3]">
                  {formatCurrency(numero(l.comissao_total))}
                  {numero(l.comissao_pendente) > 0 && (
                    <p className="text-[10px] text-[#E3D5A7]">
                      {formatCurrency(numero(l.comissao_pendente))} por pagar
                    </p>
                  )}
                </span>
              ),
            },
            {
              chave: "meta",
              rotulo: "Meta",
              alinhar: "direita",
              celula: (l) =>
                numero(l.meta_valor) > 0 ? (
                  <span className={numero(l.meta_pct) >= 100 ? "text-[#4ADE80]" : "text-[#A3A3A3]"}>
                    {Number(l.meta_pct).toFixed(0)}%
                  </span>
                ) : (
                  <span className="text-[#3F3F3F]">—</span>
                ),
            },
            {
              chave: "estado",
              rotulo: "Estado",
              celula: (l) => (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] ${
                    l.is_active ? "bg-[#0F2A18] text-[#4ADE80]" : "bg-[#2A1010] text-[#F87171]"
                  }`}
                >
                  {l.is_active ? "ativo" : "inativo"}
                </span>
              ),
            },
            {
              chave: "abrir",
              rotulo: "",
              alinhar: "direita",
              celula: (l) => (
                <Link
                  href={`/gerente/colaboradores/${l.id}`}
                  className="text-[11px] text-[#6F6F6F] transition hover:text-[#C9A962]"
                >
                  abrir →
                </Link>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}

const select =
  "rounded-lg border border-[#333] bg-[#0A0A0A] px-2.5 py-2 text-xs text-[#E5E5E5] focus:border-[#C9A962] focus:outline-none";
