"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, X } from "lucide-react";
import type { Provincia } from "@/lib/provincias";

export interface ClienteEditavel {
  id: string;
  full_name: string;
  phone: string | null;
  neighborhood: string | null;
  is_active: boolean;
  provincia_id: string | null;
}

/**
 * Edição de um cliente pela gestão.
 *
 * Nome, bairro e estado podiam ir por RLS (`profiles_update_self` deixa o
 * gestor escrever), mas o **telefone** não: ele é o email de login. Mudá-lo
 * exige tocar no Auth, e isso só o servidor faz — daí a rota
 * `/api/gerente/utilizadores/[id]`.
 */
export default function EditarCliente({
  cliente,
  provincias,
  podeMudarProvincia,
}: {
  cliente: ClienteEditavel;
  provincias: Provincia[];
  podeMudarProvincia: boolean;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState({
    full_name: cliente.full_name,
    phone: cliente.phone ?? "",
    neighborhood: cliente.neighborhood ?? "",
    provincia_id: cliente.provincia_id ?? "",
    is_active: cliente.is_active,
  });
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function guardar() {
    setErro("");
    setOcupado(true);

    const corpo: Record<string, unknown> = {
      full_name: form.full_name,
      neighborhood: form.neighborhood,
      is_active: form.is_active,
    };
    if (form.phone.trim() && form.phone.trim() !== (cliente.phone ?? "")) {
      corpo.phone = form.phone;
    }
    if (podeMudarProvincia && form.provincia_id !== (cliente.provincia_id ?? "")) {
      corpo.provincia_id = form.provincia_id || null;
    }

    try {
      const resposta = await fetch(`/api/gerente/utilizadores/${cliente.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const dados = (await resposta.json()) as { error?: string };

      if (!resposta.ok) {
        setErro(dados.error ?? "Não foi possível guardar.");
        return;
      }

      setAberto(false);
      router.refresh();
    } catch {
      setErro("Não foi possível contactar o servidor.");
    } finally {
      setOcupado(false);
    }
  }

  async function apagar() {
    if (
      !window.confirm(
        `Apagar a conta de ${cliente.full_name}? Só é possível se não tiver encomendas nem histórico.`
      )
    ) {
      return;
    }

    setErro("");
    setOcupado(true);
    try {
      const resposta = await fetch(`/api/gerente/utilizadores/${cliente.id}`, {
        method: "DELETE",
      });
      const dados = (await resposta.json()) as { error?: string };

      if (!resposta.ok) {
        setErro(dados.error ?? "Não foi possível apagar.");
        return;
      }

      setAberto(false);
      router.refresh();
    } catch {
      setErro("Não foi possível contactar o servidor.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setAberto(true);
          setErro("");
        }}
        className="inline-flex items-center gap-1 rounded-lg border border-[#333] px-2 py-1 text-[11px] text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
      >
        <Pencil className="h-3 w-3" />
        editar
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
        >
          {/* `max-h` + scroll: num telemóvel o teclado aberto reduz o ecrã a
              metade e o botão de guardar deixava de estar alcançável. */}
          <div className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-[#2A2A2A] bg-[#141414] p-5">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-sm font-medium text-[#F5F5F5]">Editar cliente</h2>
                <p className="text-[11px] text-[#525252]">{cliente.full_name}</p>
              </div>
              <button
                type="button"
                onClick={() => setAberto(false)}
                aria-label="Fechar"
                className="text-[#525252] transition hover:text-[#F5F5F5]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {erro && (
              <p className="mb-3 rounded-lg border border-[#4A2020] bg-[#2A1010] px-3 py-2 text-xs text-[#F87171]">
                {erro}
              </p>
            )}

            <div className="grid gap-3">
              <Campo
                rotulo="Nome completo"
                valor={form.full_name}
                onChange={(v) => setForm({ ...form, full_name: v })}
              />
              <Campo
                rotulo="Telefone (é o acesso)"
                valor={form.phone}
                onChange={(v) => setForm({ ...form, phone: v })}
                placeholder="+244 9xx xxx xxx"
              />
              <Campo
                rotulo="Bairro"
                valor={form.neighborhood}
                onChange={(v) => setForm({ ...form, neighborhood: v })}
              />

              {podeMudarProvincia && (
                <label className="block">
                  <span className="mb-1 block text-[11px] text-[#6F6F6F]">Província</span>
                  <select
                    value={form.provincia_id}
                    onChange={(e) => setForm({ ...form, provincia_id: e.target.value })}
                    className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
                  >
                    <option value="">Sem província</option>
                    {provincias.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome} ({p.codigo})
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="flex items-center gap-2 text-xs text-[#A3A3A3]">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="h-3.5 w-3.5 accent-[#C9A962]"
                />
                Conta ativa (pode entrar)
              </label>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={apagar}
                disabled={ocupado}
                className="inline-flex items-center gap-1 text-[11px] text-[#6F6F6F] transition hover:text-[#DC2626] disabled:opacity-50"
              >
                <Trash2 className="h-3 w-3" />
                apagar conta
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAberto(false)}
                  className="rounded-lg border border-[#333] px-3 py-2 text-xs text-[#A3A3A3] transition hover:text-[#F5F5F5]"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={guardar}
                  disabled={ocupado}
                  className="rounded-lg bg-[#C9A962] px-3 py-2 text-xs font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-50"
                >
                  {ocupado ? "A guardar…" : "Guardar"}
                </button>
              </div>
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-[#525252]">
              Mudar o telefone muda também o acesso: a pessoa passa a entrar com o número novo.
              Contas com encomendas não podem ser apagadas — desative o acesso em vez disso.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function Campo({
  rotulo,
  valor,
  onChange,
  placeholder,
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-[#6F6F6F]">{rotulo}</span>
      <input
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
      />
    </label>
  );
}
