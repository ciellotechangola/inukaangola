"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  ClipboardList,
  Percent,
  Phone,
  Tags,
  User,
  Users,
} from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { formatCurrency } from "@/lib/utils";
import { ESTADOS, estadoDe } from "@/lib/revenda";
import AprovarCandidatura from "./AprovarCandidatura";
import AcoesPedido from "./AcoesPedido";
import PrecosGrosso from "./PrecosGrosso";
import type {
  CandidaturaRev,
  PedidoLinha,
  ProdutoPreco,
  ProvinciaOpcao,
  RevendedorLinha,
} from "./page";

type Aba = "candidaturas" | "revendedores" | "pedidos" | "precos";

const COR_CANDIDATURA: Record<string, string> = {
  novo: "bg-[#2A2410] text-[#E3D5A7]",
  em_contacto: "bg-blue-950/60 text-blue-200",
  aprovado: "bg-green-950/60 text-green-200",
  recusado: "bg-red-950/60 text-red-200",
};

const COR_REVENDEDOR: Record<string, string> = {
  activo: "bg-green-950/60 text-green-200",
  suspenso: "bg-[#2A2410] text-[#E3D5A7]",
  encerrado: "bg-red-950/60 text-red-200",
};

export default function GestaoRevendedores({
  candidaturas,
  revendedores,
  pedidos,
  produtos,
  provincias,
  provinciaFixa,
  descontoEmpresa,
}: {
  candidaturas: CandidaturaRev[];
  revendedores: RevendedorLinha[];
  pedidos: PedidoLinha[];
  produtos: ProdutoPreco[];
  provincias: ProvinciaOpcao[];
  provinciaFixa: string | null;
  descontoEmpresa: number;
}) {
  const router = useRouter();
  const [aba, setAba] = useState<Aba>("candidaturas");
  const [erro, setErro] = useState("");

  const novas = candidaturas.filter((c) => c.status === "novo");
  const emCurso = pedidos.filter((p) =>
    ["novo", "em_analise", "cotado", "aprovado"].includes(p.status)
  );

  async function decidir(id: string, estado: "em_contacto" | "recusado") {
    setErro("");
    try {
      const supabase = createClientBrowser();
      const { error } = await supabase.rpc("decidir_candidatura_revendedor", {
        p_id: id,
        p_estado: estado,
      });
      if (error) throw new Error(error.message);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível actualizar.");
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2">
        <Separador
          ativo={aba === "candidaturas"}
          onClick={() => setAba("candidaturas")}
          icone={<Users className="h-3.5 w-3.5" />}
          contagem={novas.length}
        >
          Candidaturas
        </Separador>
        <Separador
          ativo={aba === "revendedores"}
          onClick={() => setAba("revendedores")}
          icone={<Building2 className="h-3.5 w-3.5" />}
          contagem={revendedores.length}
        >
          Revendedores
        </Separador>
        <Separador
          ativo={aba === "pedidos"}
          onClick={() => setAba("pedidos")}
          icone={<ClipboardList className="h-3.5 w-3.5" />}
          contagem={emCurso.length}
        >
          Pedidos
        </Separador>
        <Separador
          ativo={aba === "precos"}
          onClick={() => setAba("precos")}
          icone={<Tags className="h-3.5 w-3.5" />}
        >
          Preços de grosso
        </Separador>
      </div>

      {erro && (
        <p className="mb-4 rounded-lg border border-[#4A2020] bg-[#2A1010] px-3 py-2 text-sm text-[#F87171]">
          {erro}
        </p>
      )}

      {/* --------------------------------------------------------- CANDIDATURAS */}
      {aba === "candidaturas" && (
        <div className="space-y-3">
          {candidaturas.length === 0 && (
            <Vazio texto="Ainda não há candidaturas a revendedor. O formulário está em /revendedor." />
          )}

          {candidaturas.map((c) => (
            <article key={c.id} className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {c.tipo === "empresa" ? (
                      <Building2 className="h-4 w-4 text-[#C9A962]" />
                    ) : (
                      <User className="h-4 w-4 text-[#C9A962]" />
                    )}
                    <p className="font-medium text-[#F5F5F5]">{c.nome}</p>
                    <span className="rounded-full bg-[#262626] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[#8A8A8A]">
                      {c.tipo}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] ${
                        COR_CANDIDATURA[c.status] ?? "bg-[#262626] text-[#A3A3A3]"
                      }`}
                    >
                      {c.status === "em_contacto" ? "em contacto" : c.status}
                    </span>
                  </div>

                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#8A8A8A]">
                    <a
                      href={`tel:${c.telefone}`}
                      className="inline-flex items-center gap-1 text-[#C9A962] hover:underline"
                    >
                      <Phone className="h-3 w-3" />
                      {c.telefone}
                    </a>
                    {c.provincia && <span>· {c.provincia}</span>}
                    {c.email && <span>· {c.email}</span>}
                    {c.nif && <span>· NIF {c.nif}</span>}
                    <span>· {new Date(c.created_at).toLocaleString("pt-PT")}</span>
                  </p>

                  {c.mensagem && (
                    <p className="mt-2 max-w-xl whitespace-pre-line rounded-lg bg-[#141414] p-3 text-xs leading-relaxed text-[#A3A3A3]">
                      {c.mensagem}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-start gap-2">
                  {c.status === "novo" && (
                    <>
                      <button
                        type="button"
                        onClick={() => decidir(c.id, "em_contacto")}
                        className="rounded-lg border border-[#333] px-3 py-1.5 text-xs text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
                      >
                        Em contacto
                      </button>
                      <button
                        type="button"
                        onClick={() => decidir(c.id, "recusado")}
                        className="rounded-lg border border-[#4A2020] px-3 py-1.5 text-xs text-[#F87171] transition hover:bg-[#2A1010]"
                      >
                        Recusar
                      </button>
                    </>
                  )}

                  {c.status !== "aprovado" && c.status !== "recusado" && (
                    <AprovarCandidatura
                      candidatura={{
                        id: c.id,
                        tipo: c.tipo,
                        nome: c.nome,
                        telefone: c.telefone,
                        nif: c.nif,
                        email: c.email,
                        provincia_id: c.provincia_id,
                      }}
                      provincias={provincias}
                      provinciaFixa={provinciaFixa}
                    />
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* -------------------------------------------------------- REVENDEDORES */}
      {aba === "revendedores" && (
        <div className="space-y-3">
          {revendedores.length === 0 && (
            <Vazio texto="Ainda não há revendedores aprovados. Aprove uma candidatura para criar a primeira conta." />
          )}

          {revendedores.map((r) => (
            <FichaRevendedor key={r.id} revendedor={r} onErro={setErro} />
          ))}
        </div>
      )}

      {/* ------------------------------------------------------------- PEDIDOS */}
      {aba === "pedidos" && (
        <div className="space-y-3">
          {pedidos.length === 0 && (
            <Vazio texto="Ainda não há pedidos de grosso." />
          )}

          {pedidos.map((p) => {
            const estado = estadoDe(p.status);
            return (
              <article key={p.id} className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-sm text-[#F5F5F5]">{p.numero}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${ESTADOS[estado].cor}`}>
                        {ESTADOS[estado].rotulo}
                      </span>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-[#8A8A8A]">
                      <span className="text-[#E5E5E5]">{p.revendedor ?? "—"}</span>
                      {p.provincia && <span>· {p.provincia}</span>}
                      <span>· {p.total_unidades} unidades</span>
                      <span>· {new Date(p.created_at).toLocaleString("pt-PT")}</span>
                    </p>
                    {p.mensagem && (
                      <p className="mt-2 max-w-xl whitespace-pre-line rounded-lg bg-[#141414] p-3 text-xs leading-relaxed text-[#A3A3A3]">
                        {p.mensagem}
                      </p>
                    )}
                  </div>
                  <p className="text-lg font-light text-[#C9A962]">
                    {formatCurrency(p.valor_estimado)}
                  </p>
                </div>

                <AcoesPedido pedido={{ id: p.id, numero: p.numero, status: p.status, resposta: p.resposta }} />
              </article>
            );
          })}
        </div>
      )}

      {/* -------------------------------------------------------------- PREÇOS */}
      {aba === "precos" && (
        <PrecosGrosso produtos={produtos} descontoEmpresa={descontoEmpresa} />
      )}
    </div>
  );
}

/**
 * Ficha de um revendedor aprovado, com edição de desconto, mínimo e estado.
 * Os campos só são enviados quando mudam — `actualizar_revendedor` trata
 * `NULL` como «não mexer».
 */
function FichaRevendedor({
  revendedor,
  onErro,
}: {
  revendedor: RevendedorLinha;
  onErro: (m: string) => void;
}) {
  const router = useRouter();
  const [desconto, setDesconto] = useState(
    revendedor.desconto === null ? "" : String(Math.round(revendedor.desconto * 100))
  );
  const [minimo, setMinimo] = useState(String(revendedor.minimo_unidades));
  const [aGuardar, setAGuardar] = useState(false);

  async function guardar(estado?: string) {
    onErro("");
    setAGuardar(true);
    try {
      const supabase = createClientBrowser();
      const d = Number(String(desconto).replace(",", "."));
      const m = Number(String(minimo).replace(",", "."));

      const { error } = await supabase.rpc("actualizar_revendedor", {
        p_id: revendedor.id,
        p_desconto: String(desconto).trim() === "" ? null : d / 100,
        p_minimo: Number.isFinite(m) && m >= 1 ? Math.round(m) : null,
        p_status: estado ?? null,
        p_nota: null,
        // Campo vazio = «volta ao desconto da empresa». Sem esta bandeira,
        // `null` significaria «não mexer» e o desconto antigo ficava para sempre.
        p_limpar_desconto: String(desconto).trim() === "",
      });
      if (error) throw new Error(error.message);
      router.refresh();
    } catch (e) {
      onErro(e instanceof Error ? e.message : "Não foi possível guardar.");
    } finally {
      setAGuardar(false);
    }
  }

  return (
    <article className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {revendedor.tipo === "empresa" ? (
              <Building2 className="h-4 w-4 text-[#C9A962]" />
            ) : (
              <User className="h-4 w-4 text-[#C9A962]" />
            )}
            <p className="font-medium text-[#F5F5F5]">{revendedor.nome}</p>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] ${
                COR_REVENDEDOR[revendedor.status] ?? "bg-[#262626] text-[#A3A3A3]"
              }`}
            >
              {revendedor.status}
            </span>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-[#8A8A8A]">
            <a
              href={`tel:${revendedor.telefone}`}
              className="inline-flex items-center gap-1 text-[#C9A962] hover:underline"
            >
              <Phone className="h-3 w-3" />
              {revendedor.telefone}
            </a>
            {revendedor.provincia && <span>· {revendedor.provincia}</span>}
            {revendedor.email && <span>· {revendedor.email}</span>}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-[10px] text-[#6F6F6F]">
              <Percent className="h-3 w-3" />
              Desconto
            </span>
            <input
              value={desconto}
              onChange={(e) => setDesconto(e.target.value)}
              inputMode="decimal"
              placeholder="empresa"
              className="w-20 rounded-lg border border-[#333] bg-[#0A0A0A] px-2 py-1 text-xs text-[#F5F5F5] placeholder:text-[#4A4A4A] focus:border-[#C9A962] focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] text-[#6F6F6F]">Mínimo un.</span>
            <input
              value={minimo}
              onChange={(e) => setMinimo(e.target.value)}
              inputMode="numeric"
              className="w-20 rounded-lg border border-[#333] bg-[#0A0A0A] px-2 py-1 text-xs text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
            />
          </label>

          <button
            type="button"
            onClick={() => guardar()}
            disabled={aGuardar}
            className="rounded-lg bg-[#C9A962] px-3 py-1.5 text-xs font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A] disabled:opacity-50"
          >
            {aGuardar ? "…" : "Guardar"}
          </button>

          {revendedor.status === "activo" ? (
            <button
              type="button"
              onClick={() => guardar("suspenso")}
              disabled={aGuardar}
              className="rounded-lg border border-[#4A2020] px-3 py-1.5 text-xs text-[#F87171] transition hover:bg-[#2A1010] disabled:opacity-50"
            >
              Suspender
            </button>
          ) : (
            <button
              type="button"
              onClick={() => guardar("activo")}
              disabled={aGuardar}
              className="rounded-lg border border-[#2F6B45] px-3 py-1.5 text-xs text-[#4ADE80] transition hover:bg-[#12351F] disabled:opacity-50"
            >
              Reactivar
            </button>
          )}
        </div>
      </div>

      {revendedor.nota && (
        <p className="mt-3 rounded-lg bg-[#141414] p-3 text-xs leading-relaxed text-[#A3A3A3]">
          {revendedor.nota}
        </p>
      )}
    </article>
  );
}

function Separador({
  ativo,
  onClick,
  icone,
  contagem,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  icone: React.ReactNode;
  contagem?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition ${
        ativo
          ? "border-[#C9A962]/60 bg-[#C9A962]/10 text-[#C9A962]"
          : "border-[#333] text-[#A3A3A3] hover:border-[#C9A962]/50 hover:text-[#C9A962]"
      }`}
    >
      {icone}
      {children}
      {typeof contagem === "number" && contagem > 0 && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[9px] ${
            ativo ? "bg-[#C9A962] text-[#0A0A0A]" : "bg-[#262626] text-[#A3A3A3]"
          }`}
        >
          {contagem}
        </span>
      )}
    </button>
  );
}

function Vazio({ texto }: { texto: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[#2A2A2A] bg-[#111] px-6 py-14 text-center">
      <p className="text-sm text-[#A3A3A3]">{texto}</p>
    </div>
  );
}
