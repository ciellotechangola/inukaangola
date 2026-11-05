"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Loader2, Pencil, Trash2, X } from "lucide-react";

export interface ReservaGerida {
  id: string;
  nome: string;
  telefone: string;
  bairro: string | null;
  provincia: string | null;
  colaborador: string | null;
  desde: string;
}

const ENTRADA =
  "w-full rounded-lg border border-[#333] bg-[#0F0F0F] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none";

/**
 * Reservas por activar, do lado da gestão.
 *
 * O colaborador via-as na carteira dele; a gestão não via nada. Eram dados
 * escritos na base sem nenhum ecrã de gestão — e o telefone de uma reserva é
 * exactamente o género de dado que sai errado (um dígito trocado ao balcão).
 * Aqui corrige-se sem cancelar a reserva, e portanto sem perder as compras que
 * estejam à espera daquele número.
 */
export default function ReservasPorActivar({ reservas }: { reservas: ReservaGerida[] }) {
  const router = useRouter();
  // Aberto por omissão: uma reserva por activar é trabalho à espera de alguém,
  // não um detalhe escondido atrás de um clique.
  const [aberta, setAberta] = useState(true);
  const [editar, setEditar] = useState<string | null>(null);
  const [form, setForm] = useState({ nome: "", telefone: "", bairro: "" });
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);

  function abrirEdicao(r: ReservaGerida) {
    setEditar(r.id);
    setForm({ nome: r.nome, telefone: r.telefone, bairro: r.bairro ?? "" });
    setErro("");
    setAviso("");
  }

  async function guardar(id: string) {
    setOcupado(true);
    setErro("");
    setAviso("");
    try {
      const resposta = await fetch("/api/vendedor/clientes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          full_name: form.nome,
          phone: form.telefone,
          neighborhood: form.bairro,
        }),
      });
      const dados = (await resposta.json().catch(() => ({}))) as {
        error?: string;
        vendas_orfaas?: number;
      };
      if (!resposta.ok) {
        setErro(dados.error ?? "Não foi possível guardar.");
        return;
      }
      setEditar(null);
      setAviso(
        dados.vendas_orfaas
          ? `Reserva actualizada. Atenção: ${dados.vendas_orfaas} venda(s) registadas com o número antigo ficaram sem dono.`
          : "Reserva actualizada."
      );
      router.refresh();
    } catch {
      setErro("Não foi possível contactar o servidor.");
    } finally {
      setOcupado(false);
    }
  }

  async function cancelar(id: string, nome: string) {
    if (!window.confirm(`Cancelar a reserva de ${nome}? O número fica livre.`)) return;
    setOcupado(true);
    setErro("");
    setAviso("");
    try {
      const resposta = await fetch(`/api/vendedor/clientes?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const dados = (await resposta.json().catch(() => ({}))) as { error?: string };
      if (!resposta.ok) {
        setErro(dados.error ?? "Não foi possível cancelar.");
        return;
      }
      setAviso(`Reserva de ${nome} cancelada.`);
      router.refresh();
    } catch {
      setErro("Não foi possível contactar o servidor.");
    } finally {
      setOcupado(false);
    }
  }

  if (reservas.length === 0) return null;

  return (
    <section className="mb-8 rounded-xl border border-[#3A3324] bg-[#151310]">
      <button
        type="button"
        onClick={() => setAberta((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2 text-sm text-[#F5F5F5]">
          <Clock className="h-4 w-4 text-[#C9A962]" />
          {reservas.length} {reservas.length === 1 ? "cliente" : "clientes"} por activar
        </span>
        <span className="text-[11px] text-[#6F6F6F]">
          {aberta ? "fechar" : "ver e corrigir"}
        </span>
      </button>

      {aberta && (
        <div className="border-t border-[#2A2A2A] px-5 py-4">
          <p className="mb-3 text-[11px] leading-relaxed text-[#6F6F6F]">
            Reservados por um colaborador, ainda sem conta. A conta é aberta pelo próprio cliente,
            com este número — nessa altura a reserva fecha-se sozinha e ele entra na carteira de
            quem o registou.
          </p>

          {erro && <p className="mb-3 text-xs text-[#F87171]">{erro}</p>}
          {aviso && <p className="mb-3 text-xs text-[#B9E6C8]">{aviso}</p>}

          <ul className="space-y-2">
            {reservas.map((r) => (
              <li key={r.id} className="rounded-lg border border-[#2A2A2A] bg-[#121212] p-3">
                {editar === r.id ? (
                  <div className="space-y-2">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <input
                        value={form.nome}
                        onChange={(e) => setForm({ ...form, nome: e.target.value })}
                        placeholder="Nome"
                        className={ENTRADA}
                      />
                      <input
                        value={form.telefone}
                        onChange={(e) => setForm({ ...form, telefone: e.target.value })}
                        placeholder="+244 9xx xxx xxx"
                        className={ENTRADA}
                      />
                      <input
                        value={form.bairro}
                        onChange={(e) => setForm({ ...form, bairro: e.target.value })}
                        placeholder="Bairro"
                        className={ENTRADA}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void guardar(r.id)}
                        disabled={ocupado}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#C9A962] px-3 py-1.5 text-[11px] font-semibold text-[#0A0A0A] disabled:opacity-50"
                      >
                        {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        Guardar
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditar(null)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#333] px-3 py-1.5 text-[11px] text-[#A3A3A3]"
                      >
                        <X className="h-3 w-3" /> Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-[#F5F5F5]">{r.nome}</p>
                      <p className="text-[11px] text-[#6F6F6F]">
                        {r.telefone}
                        {r.bairro ? ` · ${r.bairro}` : ""}
                        {r.provincia ? ` · ${r.provincia}` : ""}
                      </p>
                      <p className="text-[11px] text-[#525252]">
                        reservado por {r.colaborador ?? "—"} em{" "}
                        {new Date(r.desde).toLocaleDateString("pt-PT")}
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => abrirEdicao(r)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#333] px-2.5 py-1.5 text-[11px] text-[#D4D4D4] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
                      >
                        <Pencil className="h-3 w-3" /> Corrigir
                      </button>
                      <button
                        type="button"
                        onClick={() => void cancelar(r.id, r.nome)}
                        disabled={ocupado}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#333] px-2.5 py-1.5 text-[11px] text-[#D4D4D4] transition hover:border-[#DC2626]/60 hover:text-[#DC2626] disabled:opacity-50"
                      >
                        <Trash2 className="h-3 w-3" /> Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
