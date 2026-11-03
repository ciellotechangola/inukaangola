"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, X } from "lucide-react";
import type { Provincia } from "@/lib/provincias";

/**
 * Criar um cliente a partir do painel de gestão.
 *
 * Passa pela mesma rota que cria colaboradores: criar conta exige a Admin API,
 * que só existe no servidor.
 */
export default function NovoCliente({
  provincias,
  provinciaFixa,
}: {
  provincias: Provincia[];
  /** Gestor provincial: a província não se escolhe. */
  provinciaFixa: string | null;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    password: "",
    neighborhood: "",
    provincia_id: provinciaFixa ?? "",
  });
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function criar() {
    setErro("");
    if (form.full_name.trim().length < 3) {
      setErro("Indique o nome completo.");
      return;
    }
    if (!form.phone.trim()) {
      setErro("Indique o telefone — é o que a pessoa usa para entrar.");
      return;
    }
    if (form.password.length < 6) {
      setErro("A palavra-passe provisória precisa de pelo menos 6 caracteres.");
      return;
    }

    setOcupado(true);
    try {
      const resposta = await fetch("/api/gerente/utilizadores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "customer", ...form }),
      });
      const dados = (await resposta.json()) as { error?: string };

      if (!resposta.ok) {
        setErro(dados.error ?? "Não foi possível criar a conta.");
        return;
      }

      setForm({ full_name: "", phone: "", password: "", neighborhood: "", provincia_id: provinciaFixa ?? "" });
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
        className="inline-flex items-center gap-2 rounded-lg bg-[#C9A962] px-4 py-2 text-sm font-semibold text-[#0A0A0A] transition hover:bg-[#D8BC7A]"
      >
        <UserPlus className="h-4 w-4" />
        Novo cliente
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
              <h2 className="text-sm font-medium text-[#F5F5F5]">Novo cliente</h2>
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
              <Campo rotulo="Nome completo" valor={form.full_name} onChange={(v) => setForm({ ...form, full_name: v })} />
              <Campo rotulo="Telefone" valor={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="+244 9xx xxx xxx" />
              <Campo rotulo="Palavra-passe provisória" valor={form.password} onChange={(v) => setForm({ ...form, password: v })} />
              <Campo rotulo="Bairro" valor={form.neighborhood} onChange={(v) => setForm({ ...form, neighborhood: v })} />

              {!provinciaFixa && (
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
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAberto(false)}
                className="rounded-lg border border-[#333] px-3 py-2 text-xs text-[#A3A3A3] transition hover:text-[#F5F5F5]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={criar}
                disabled={ocupado}
                className="rounded-lg bg-[#C9A962] px-3 py-2 text-xs font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-50"
              >
                {ocupado ? "A criar…" : "Criar cliente"}
              </button>
            </div>
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
