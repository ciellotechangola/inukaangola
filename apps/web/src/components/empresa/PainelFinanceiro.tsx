"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClientBrowser } from "@/lib/supabase-browser";
import { formatCurrency } from "@/lib/utils";
import { mensagemDeErro } from "@/lib/erros";
import {
  CAMPOS_FINANCEIROS,
  indicadoresDoAmbito,
  lerNumero,
  quandoFinanceiro,
  rotuloDoCampo,
  type CampoFinanceiro,
  type Indicador,
  type PainelFinanceiro,
} from "@/lib/financeiro";

const PATCH = "supabase/PATCH_PAINEL_FINANCEIRO.sql";

const ENTRADA =
  "w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none disabled:opacity-60";
const ROTULO = "mb-1 block text-[10px] uppercase tracking-wider text-[#8A8A8A]";

export interface ProvinciaOpcao {
  id: string;
  nome: string;
  is_default: boolean;
}

function texto(valor: number | null): string {
  return valor === null ? "" : String(valor);
}

function paraTexto(
  indicadores: Record<CampoFinanceiro, Indicador>
): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const c of CAMPOS_FINANCEIROS) {
    saida[c.chave] = texto(indicadores[c.chave]?.manual ?? null);
  }
  return saida;
}

function dinheiro(valor: number | null): string {
  return valor === null ? "—" : formatCurrency(valor);
}

export default function PainelFinanceiro({
  painel,
  provincias,
  nacional,
}: {
  painel: PainelFinanceiro;
  provincias: ProvinciaOpcao[];
  nacional: boolean;
}) {
  const router = useRouter();
  const [provinciaId, setProvinciaId] = useState(painel.provincia_id ?? "");
  const indicadores = useMemo(
    () => indicadoresDoAmbito(painel, provinciaId || null),
    [painel, provinciaId]
  );

  /**
   * A administração nacional só corrige a sua zona (a província-sede); as
   * outras províncias calculam automaticamente. O painel da empresa (sem
   * província) continua a ser dela. A base aplica a mesma regra — isto só
   * evita mostrar campos que vão ser recusados.
   */
  const sedeId = provincias.find((p) => p.is_default)?.id ?? null;
  const podeEditarPainel =
    painel.pode_editar && (!nacional || provinciaId === "" || provinciaId === sedeId);

  const [valores, setValores] = useState<Record<string, string>>(() =>
    paraTexto(indicadores)
  );
  const [nota, setNota] = useState("");
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  // Mudar de província recarrega os valores dela — e limpa o que estava escrito.
  // Feito no próprio evento (e não num efeito) para o aviso de «guardado» não
  // desaparecer quando a página se actualiza depois de gravar.
  function mudarProvincia(id: string) {
    setProvinciaId(id);
    setValores(paraTexto(indicadoresDoAmbito(painel, id || null)));
    setNota("");
    setErro("");
    setAviso("");
  }

  /**
   * O que o cartão mostraria se guardasse agora. Campo vazio = automático;
   * campo escrito = o número que está no input. Assim o resumo acompanha a
   * edição sem esperar pela gravação.
   */
  function previsto(campo: CampoFinanceiro): number | null {
    const bruto = (valores[campo] ?? "").trim();
    if (bruto === "") return indicadores[campo]?.automatico ?? null;
    return lerNumero(bruto) ?? indicadores[campo]?.valor ?? null;
  }

  const caixaPrev = previsto("activo_total");
  const bensPrev = previsto("activo_contabilistico");
  const pagarPrev = previsto("valores_a_pagar");
  const despesasPrev = previsto("despesas_reais");
  const metaPrev = previsto("meta_financeira");

  const liquidoPrev =
    (valores.activo_liquido ?? "").trim() === ""
      ? caixaPrev !== null && despesasPrev !== null
        ? caixaPrev - despesasPrev
        : null
      : previsto("activo_liquido");

  const progressoPrev =
    metaPrev !== null && metaPrev > 0 && liquidoPrev !== null
      ? Math.round((100 * liquidoPrev) / metaPrev)
      : null;

  const porGuardar =
    nota.trim() !== "" ||
    CAMPOS_FINANCEIROS.some((c) => {
      const salvo = indicadores[c.chave]?.manual ?? null;
      const bruto = (valores[c.chave] ?? "").trim();
      if (bruto === "") return salvo !== null;
      const n = lerNumero(bruto);
      return n === null || n !== salvo;
    });

  function definir(campo: CampoFinanceiro, valor: string) {
    setValores((v) => ({ ...v, [campo]: valor }));
    setAviso("");
  }

  function usarAutomatico(campo: CampoFinanceiro) {
    setValores((v) => ({ ...v, [campo]: "" }));
    setAviso("");
  }

  function copiarAutomatico(campo: CampoFinanceiro) {
    const auto = indicadores[campo]?.automatico;
    if (auto === null || auto === undefined) return;
    setValores((v) => ({ ...v, [campo]: String(auto) }));
    setAviso("");
  }

  async function guardar() {
    setErro("");
    setAviso("");

    const payload: Record<string, number | null> = {};
    for (const c of CAMPOS_FINANCEIROS) {
      const bruto = (valores[c.chave] ?? "").trim();
      if (bruto === "") {
        // Vazio = automático. É uma escolha, não uma falta.
        payload[c.chave] = null;
        continue;
      }
      const n = lerNumero(bruto);
      if (n === null) {
        setErro(`«${c.rotulo}» não é um número válido.`);
        return;
      }
      if (!c.negativo && n < 0) {
        setErro(`«${c.rotulo}» não pode ser negativo.`);
        return;
      }
      payload[c.chave] = n;
    }

    setAGravar(true);
    const supabase = createClientBrowser();
    const { error } = await supabase.rpc("guardar_indicadores", {
      p_valores: payload,
      p_provincia_id: nacional ? provinciaId || null : null,
      p_nota: nota.trim() || null,
    });
    setAGravar(false);

    if (error) {
      setErro(mensagemDeErro(error, PATCH));
      return;
    }

    setAviso(
      provinciaId || !nacional
        ? "Indicadores guardados. Os valores escritos passam a contar no painel."
        : "Indicadores da empresa guardados. Passam a contar no total nacional."
    );
    setNota("");
    router.refresh();
  }

  async function repor() {
    setErro("");
    setAviso("");

    if (
      !window.confirm(
        "Repor todos os indicadores no automático? Os valores escritos à mão são removidos (o histórico fica guardado)."
      )
    ) {
      return;
    }

    setAGravar(true);
    const supabase = createClientBrowser();
    const { error } = await supabase.rpc("limpar_indicadores", {
      p_provincia_id: nacional ? provinciaId || null : null,
    });
    setAGravar(false);

    if (error) {
      setErro(mensagemDeErro(error, PATCH));
      return;
    }

    setAviso("Painel reposto. Tudo volta a ser calculado automaticamente.");
    setValores({});
    setNota("");
    router.refresh();
  }

  const nomeAmbito = nacional
    ? provinciaId
      ? provincias.find((p) => p.id === provinciaId)?.nome ?? painel.provincia ?? "Província"
      : "Empresa toda"
    : painel.provincia ?? "A sua província";

  return (
    <div>
      <div className="mb-5 rounded-xl border border-[#C9A962]/30 bg-[#121212] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h2 className="text-sm uppercase tracking-wider text-[#C9A962]">
              Painel financeiro
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#A3A3A3]">
              Todos os campos são editáveis e nenhum é obrigatório.{" "}
              <strong className="font-medium text-[#F5F5F5]">
                Deixe vazio para usar o cálculo automático
              </strong>{" "}
              — o automático aparece sempre ao lado, só como referência, e nunca
              substitui o valor que escreveu. Cada alteração fica no histórico.
            </p>
          </div>
          {nacional && (
            <div className="w-full sm:w-64">
              <label className={ROTULO} htmlFor="pf-provincia">
                Âmbito
              </label>
              <select
                id="pf-provincia"
                value={provinciaId}
                onChange={(e) => mudarProvincia(e.target.value)}
                className={ENTRADA}
              >
                <option value="">Empresa toda (total nacional)</option>
                {provincias.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                    {p.is_default ? " · sede" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {erro && (
        <div className="mb-4 rounded-lg border border-[#4A2020] bg-[#2A1010] p-3 text-sm text-[#F87171]">
          {erro}
        </div>
      )}
      {aviso && (
        <div className="mb-4 rounded-lg border border-[#1F4D2E] bg-[#0E2417] p-3 text-sm text-[#22C55E]">
          {aviso}
        </div>
      )}

      {/* ------------------------------ Resumo ------------------------------ */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Resumo
          rotulo="Activo total (caixa)"
          valor={dinheiro(caixaPrev)}
          nota={`Bens à parte: ${dinheiro(bensPrev)}`}
          cor="text-[#C9A962]"
        />
        <Resumo
          rotulo="Activo contabilístico"
          valor={dinheiro(bensPrev)}
          nota={`Stock ${dinheiro(painel.total.stock_valor)} · ${painel.total.stock_unidades} un.`}
          cor="text-[#E3D5A7]"
        />
        <Resumo
          rotulo="Valores a pagar"
          valor={dinheiro(pagarPrev)}
          nota={`${painel.total.pendentes_count} despesa${
            painel.total.pendentes_count === 1 ? "" : "s"
          } pendente${painel.total.pendentes_count === 1 ? "" : "s"}`}
          cor="text-[#F5F5F5]"
        />
        <Resumo
          rotulo="Activo líquido"
          valor={dinheiro(liquidoPrev)}
          nota={
            metaPrev === null
              ? "Sem meta definida"
              : progressoPrev === null
                ? "Meta definida"
                : `${progressoPrev} % da meta`
          }
          cor={
            liquidoPrev !== null && liquidoPrev < 0
              ? "text-[#F87171]"
              : "text-[#22C55E]"
          }
        />
      </div>

      {metaPrev !== null && metaPrev > 0 && (
        <div className="mb-6 rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="text-[#A3A3A3]">
              Meta financeira · <span className="text-[#F5F5F5]">{nomeAmbito}</span>
            </span>
            <span className="text-[#C9A962]">
              {dinheiro(liquidoPrev)} de {dinheiro(metaPrev)}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[#262626]">
            <div
              className={`h-full rounded-full ${
                liquidoPrev !== null && liquidoPrev < 0
                  ? "bg-[#F87171]"
                  : "bg-[#C9A962]"
              }`}
              style={{
                width: `${Math.min(Math.max(progressoPrev ?? 0, 0), 100)}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* ---------------------------- Indicadores --------------------------- */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-xl font-light text-[#F5F5F5]">Indicadores</h2>
          <p className="text-sm text-[#A3A3A3]">
            {nomeAmbito}. Escreva o valor que apurou; o campo vazio fica no automático.
          </p>
        </div>
        <span className="text-[11px] text-[#525252]">
          {podeEditarPainel
            ? "Pode editar"
            : nacional && provinciaId !== ""
              ? "Automático — fora da sua zona"
              : "Só leitura"}
        </span>
      </div>

      <div className="mb-6 grid gap-3 md:grid-cols-2">
        {CAMPOS_FINANCEIROS.map((c) => {
          const ind = indicadores[c.chave];
          const manual = ind?.manual ?? null;
          const auto = ind?.automatico ?? null;
          const escrito = (valores[c.chave] ?? "").trim() !== "";

          return (
            <div
              key={c.chave}
              className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wider text-[#8A8A8A]">
                    {c.rotulo}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-[#6F6F6F]">
                    {c.descricao}
                  </p>
                </div>
                <Selo indicador={ind} escrito={escrito} />
              </div>

              <input
                aria-label={c.rotulo}
                value={valores[c.chave] ?? ""}
                onChange={(e) => definir(c.chave, e.target.value)}
                inputMode="decimal"
                disabled={!podeEditarPainel}
                placeholder={
                  auto !== null ? `Automático: ${auto}` : "Sem valor automático"
                }
                className={`${ENTRADA} mt-3`}
              />

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-[#525252]">
                  {auto !== null ? (
                    <>
                      {c.notaAuto ?? "Automático"}:{" "}
                      <span className="text-[#A3A3A3]">{dinheiro(auto)}</span>
                    </>
                  ) : (
                    c.notaAuto ?? "Sem cálculo automático"
                  )}
                  {manual !== null && (
                    <>
                      {" · escrito: "}
                      <span className="text-[#C9A962]">{dinheiro(manual)}</span>
                    </>
                  )}
                </p>

                {podeEditarPainel && (
                  <div className="flex gap-2">
                    {escrito && (
                      <button
                        type="button"
                        onClick={() => usarAutomatico(c.chave)}
                        className="text-[11px] text-[#8A8A8A] underline-offset-2 hover:text-[#C9A962] hover:underline"
                      >
                        Automático
                      </button>
                    )}
                    {!escrito && auto !== null && (
                      <button
                        type="button"
                        onClick={() => copiarAutomatico(c.chave)}
                        className="text-[11px] text-[#8A8A8A] underline-offset-2 hover:text-[#C9A962] hover:underline"
                      >
                        Copiar automático
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {podeEditarPainel && (
        <div className="mb-8 rounded-xl border border-[#262626] bg-[#1A1A1A] p-5">
          <label className={ROTULO} htmlFor="pf-nota">
            Nota desta alteração (opcional)
          </label>
          <input
            id="pf-nota"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Ex.: contagem de caixa em 26/11 + stock reavaliado"
            className={ENTRADA}
          />
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={guardar}
              disabled={aGravar}
              className="rounded-lg bg-[#C9A962] px-5 py-2.5 text-sm font-semibold tracking-wide text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-50"
            >
              {aGravar ? "A guardar…" : "GUARDAR INDICADORES"}
            </button>
            <button
              onClick={repor}
              disabled={aGravar}
              className="rounded-lg border border-[#333333] px-4 py-2.5 text-sm text-[#A3A3A3] transition hover:border-[#C9A962]/40 hover:text-[#C9A962] disabled:opacity-50"
            >
              Repor tudo no automático
            </button>
            {porGuardar && (
              <span className="self-center text-[11px] text-[#C9A962]">
                Alterações por guardar
              </span>
            )}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-[#525252]">
            O activo líquido automático segue a regra do resto da aplicação: activo total menos
            despesas reais. Se preferir outra leitura, escreva o valor no campo.
          </p>
        </div>
      )}

      {/* ----------------------------- Histórico ---------------------------- */}
      <div className="overflow-hidden rounded-xl border border-[#262626]">
        <div className="flex items-center justify-between gap-3 border-b border-[#1F1F1F] bg-[#141414] px-4 py-3">
          <span className="text-sm font-medium text-[#F5F5F5]">
            Histórico de alterações
          </span>
          <span className="text-[11px] text-[#525252]">
            {painel.historico.length} registo{painel.historico.length === 1 ? "" : "s"}
          </span>
        </div>

        {painel.historico.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-[#525252]">
            Ainda não há alterações. Enquanto não escrever nada, todos os valores são
            automáticos.
          </p>
        ) : (
          <ul className="divide-y divide-[#1F1F1F]">
            {painel.historico.map((h) => (
              <li key={h.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm text-[#F5F5F5]">
                    {rotuloDoCampo(h.campo)}
                    {h.provincia ? (
                      <span className="ml-2 text-[11px] text-[#6F6F6F]">
                        {h.provincia}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-[11px] text-[#6F6F6F]">
                    {h.quem ?? "—"} · {quandoFinanceiro(h.quando)}
                  </p>
                </div>
                <p className="mt-0.5 text-[12px] text-[#A3A3A3]">
                  {dinheiro(h.valor_anterior)} →{" "}
                  <span className="text-[#C9A962]">{dinheiro(h.valor_novo)}</span>
                  {h.valor_novo === null && h.campo !== "todos"
                    ? " (automático)"
                    : ""}
                </p>
                {h.nota && (
                  <p className="mt-0.5 text-[11px] text-[#525252]">{h.nota}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Selo({
  indicador,
  escrito,
}: {
  indicador: Indicador | undefined;
  escrito: boolean;
}) {
  const manual = escrito || (indicador?.manual ?? null) !== null;
  const temAuto =
    indicador?.automatico !== null && indicador?.automatico !== undefined;

  return (
    <span
      className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] ${
        manual
          ? "border-[#4A3F1F] bg-[#241E0E] text-[#C9A962]"
          : "border-[#333333] text-[#8A8A8A]"
      }`}
    >
      {manual ? "Manual" : temAuto ? "Automático" : "Sem valor"}
    </span>
  );
}

function Resumo({
  rotulo,
  valor,
  nota,
  cor,
}: {
  rotulo: string;
  valor: string;
  nota: string;
  cor: string;
}) {
  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-[#525252]">
        {rotulo}
      </p>
      <p className={`text-lg font-medium ${cor}`}>{valor}</p>
      <p className="mt-0.5 text-[11px] text-[#525252]">{nota}</p>
    </div>
  );
}
