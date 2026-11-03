import type { ReactNode } from "react";

/**
 * Tabela que se transforma em cartões no telemóvel.
 *
 * Uma tabela de 9 colunas num ecrã de 390 px não se lê: ou transborda, ou
 * obriga a deslizar de lado a perder de vista de quem é a linha. Abaixo de
 * `md` cada linha passa a ser um cartão com rótulo e valor, que é como as
 * listas se lêem num telemóvel.
 *
 * Sem `"use client"` de propósito: as páginas de gestão são componentes de
 * servidor e passam funções (`celula`) como propriedades — isso só é possível
 * enquanto este ficheiro não atravessa a fronteira cliente/servidor. Também
 * corre dentro de componentes de cliente sem alterações.
 */
export interface ColunaTabela<T> {
  chave: string;
  rotulo: string;
  celula: (item: T) => ReactNode;
  /** Alinhamento no computador. No cartão o valor está sempre à direita. */
  alinhar?: "esquerda" | "direita";
  /** Esconde no cartão (acções redundantes, colunas só para desktop). */
  ocultarNoCartao?: boolean;
  /** Passa a ser o cabeçalho do cartão. Se nenhuma o tiver, usa-se a 1.ª. */
  titulo?: boolean;
  /** Largura mínima da coluna, ex.: "9rem". */
  largura?: string;
}

export default function TabelaResponsiva<T>({
  itens,
  colunas,
  chaveDe,
  vazio,
  minimo = 640,
  moldura = true,
  className = "",
}: {
  itens: T[];
  colunas: ColunaTabela<T>[];
  chaveDe: (item: T) => string;
  vazio?: ReactNode;
  /** Largura mínima da tabela no computador, em px. */
  minimo?: number;
  /** `false` quando o cartão que envolve a tabela já tem moldura própria. */
  moldura?: boolean;
  className?: string;
}) {
  if (itens.length === 0) return <>{vazio ?? null}</>;

  const titulo = colunas.find((c) => c.titulo) ?? colunas[0];
  const detalhe = colunas.filter((c) => c !== titulo && !c.ocultarNoCartao);

  return (
    <>
      {/* ---------------- Telemóvel: um cartão por linha ---------------- */}
      <ul className={`space-y-3 md:hidden ${moldura ? "" : "p-3"}`}>
        {itens.map((item) => (
          <li
            key={chaveDe(item)}
            className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4"
          >
            <div className="mb-3">{titulo.celula(item)}</div>

            {detalhe.length > 0 && (
              <dl className="space-y-2 border-t border-[#232323] pt-3 text-sm">
                {detalhe.map((coluna) => (
                  <div key={coluna.chave} className="flex items-start justify-between gap-3">
                    <dt className="shrink-0 pt-0.5 text-[10px] uppercase tracking-wide text-[#525252]">
                      {coluna.rotulo}
                    </dt>
                    <dd className="min-w-0 text-right text-[#E5E5E5]">{coluna.celula(item)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ul>

      {/* ---------------- Computador: tabela ---------------- */}
      <div
        className={`tabela-deslizante hidden md:block ${
          moldura ? "rounded-xl border border-[#262626]" : ""
        } ${className}`}
      >
        <table className="w-full text-sm" style={{ minWidth: minimo }}>
          <thead className="bg-[#141414] text-left text-[10px] uppercase tracking-wider text-[#5A5A5A]">
            <tr>
              {colunas.map((coluna) => (
                <th
                  key={coluna.chave}
                  style={coluna.largura ? { width: coluna.largura } : undefined}
                  className={`px-4 py-3 font-normal ${
                    coluna.alinhar === "direita" ? "text-right" : ""
                  }`}
                >
                  {coluna.rotulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {itens.map((item) => (
              <tr
                key={chaveDe(item)}
                className="border-t border-[#1F1F1F] bg-[#1A1A1A] hover:bg-[#1F1F1F]"
              >
                {colunas.map((coluna) => (
                  <td
                    key={coluna.chave}
                    className={`px-4 py-3 ${coluna.alinhar === "direita" ? "text-right" : ""}`}
                  >
                    {coluna.celula(item)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
