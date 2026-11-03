import { rotuloMes } from "@/lib/colaborador";

/**
 * Gráfico de evolução em barras.
 *
 * Feito com `div`s e percentagens em vez de uma biblioteca: são seis pontos,
 * não precisa de eixo, zoom nem tooltip, e assim não entra mais um pacote no
 * bundle nem um `<canvas>` que não imprime bem.
 */
export function GraficoEvolucao({
  titulo,
  meses,
  valores,
  formato,
  cor = "#C9A962",
  vazio = "Sem dados no período.",
}: {
  titulo: string;
  meses: string[];
  valores: number[];
  formato: (n: number) => string;
  cor?: string;
  vazio?: string;
}) {
  const maximo = Math.max(...valores.map((v) => Number(v) || 0), 0);
  const temDados = maximo > 0;

  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
      <div className="mb-5 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-[#F5F5F5]">{titulo}</h2>
        <span className="text-[11px] text-[#525252]">últimos 6 meses</span>
      </div>

      {!temDados ? (
        <p className="py-8 text-center text-sm text-[#525252]">{vazio}</p>
      ) : (
        <div className="flex h-40 items-end gap-2">
          {valores.map((valor, i) => {
            const v = Number(valor) || 0;
            const altura = maximo > 0 ? Math.max((v / maximo) * 100, v > 0 ? 4 : 0) : 0;
            return (
              <div key={meses[i] ?? i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[10px] tabular-nums text-[#6F6F6F]">
                  {v > 0 ? formato(v) : ""}
                </span>
                <div
                  title={`${rotuloMes(meses[i])}: ${formato(v)}`}
                  className="w-full rounded-t transition-all"
                  style={{
                    height: `${altura}%`,
                    backgroundColor: cor,
                    opacity: i === valores.length - 1 ? 1 : 0.55,
                  }}
                />
                <span className="text-[10px] uppercase tracking-wide text-[#525252]">
                  {rotuloMes(meses[i])}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Barra de progresso da meta, com o valor em cima. */
export function ProgressoMeta({
  valor,
  meta,
  percentagem,
  origem,
}: {
  valor: number;
  meta: number;
  percentagem: number;
  origem: "individual" | "provincia" | null;
}) {
  const pct = Math.min(Number(percentagem) || 0, 100);
  const atingiu = Number(percentagem) >= 100;

  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-[#F5F5F5]">Meta do mês</h2>
        <span className="text-[11px] text-[#525252]">
          {origem === "individual" ? "meta individual" : origem === "provincia" ? "meta da província" : "sem meta"}
        </span>
      </div>

      {meta <= 0 ? (
        <p className="py-6 text-sm text-[#525252]">
          Ainda não foi definida uma meta. A gestão pode defini-la na ficha do colaborador.
        </p>
      ) : (
        <>
          <div className="mb-3 flex items-end justify-between">
            <span className="text-2xl font-light text-[#C9A962]">{Number(percentagem).toFixed(0)}%</span>
            <span className="text-xs text-[#A3A3A3]">
              {new Intl.NumberFormat("pt-AO").format(valor)} / {new Intl.NumberFormat("pt-AO").format(meta)} AOA
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[#0F0F0F]">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${pct}%`, backgroundColor: atingiu ? "#4ADE80" : "#C9A962" }}
            />
          </div>
          <p className="mt-2 text-[11px] text-[#525252]">
            {atingiu
              ? "Meta atingida. Bom trabalho."
              : `Faltam ${new Intl.NumberFormat("pt-AO").format(Math.max(meta - valor, 0))} AOA para a meta.`}
          </p>
        </>
      )}
    </div>
  );
}
