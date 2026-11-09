"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Store, UserPlus, X } from "lucide-react";
import type { Provincia } from "@/lib/provincias";

/**
 * Criar uma conta de vendedor de loja.
 *
 * A conta nasce na Admin API (`/api/gerente/utilizadores`), porque criar um
 * utilizador exige `service_role` — a chave nunca vai para o browser. O papel
 * é `store_seller`: stock e balcão, sem carteira de clientes e sem comissão.
 */
export default function NovoVendedorLoja({
  provincias,
  provinciaFixa,
}: {
  provincias: Provincia[];
  /** Gestor provincial: a província não se escolhe. */
  provinciaFixa: string | null;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [aGuardar, setAGuardar] = useState(false);
  const [erro, setErro] = useState("");
  const [criada, setCriada] = useState<{ nome: string; telefone: string; palavra: string } | null>(
    null
  );
  const [copiado, setCopiado] = useState(false);

  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    password: "",
    provincia_id: provinciaFixa ?? "",
  });

  function fechar() {
    setAberto(false);
    setErro("");
    setCriada(null);
    setCopiado(false);
    setForm({ full_name: "", phone: "", password: "", provincia_id: provinciaFixa ?? "" });
  }

  async function criar() {
    setErro("");

    if (form.full_name.trim().length < 3) {
      setErro("Indique o nome completo.");
      return;
    }
    if (form.password.length < 6) {
      setErro("A palavra-passe provisória precisa de pelo menos 6 caracteres.");
      return;
    }

    setAGuardar(true);
    try {
      const r = await fetch("/api/gerente/utilizadores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, role: "store_seller" }),
      });
      const corpo = (await r.json()) as { error?: string };

      if (!r.ok) throw new Error(corpo.error ?? "Não foi possível criar a conta.");

      setCriada({
        nome: form.full_name.trim(),
        telefone: form.phone.trim(),
        palavra: form.password,
      });
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível criar a conta.");
    } finally {
      setAGuardar(false);
    }
  }

  const campo =
    "w-full rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none";

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-[#5FBF8F] px-4 py-2.5 text-sm font-semibold text-[#07130D] transition hover:bg-[#78D6A6]"
      >
        <UserPlus className="h-4 w-4" />
        Novo vendedor de loja
      </button>

      {aberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-[#262626] bg-[#141414]">
            <header className="flex items-center justify-between border-b border-[#262626] px-4 py-3">
              <h2 className="flex items-center gap-2 text-sm font-medium text-[#F5F5F5]">
                <Store className="h-4 w-4 text-[#5FBF8F]" />
                Vendedor de loja
              </h2>
              <button onClick={fechar} aria-label="Fechar" className="text-[#8A8A8A] hover:text-[#F5F5F5]">
                <X className="h-4 w-4" />
              </button>
            </header>

            {criada ? (
              <div className="p-4">
                <p className="mb-3 flex items-center gap-2 text-sm text-[#4ADE80]">
                  <Check className="h-4 w-4" /> Conta criada.
                </p>
                <dl className="space-y-2 rounded-lg border border-[#262626] bg-[#0A0A0A] p-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#8A8A8A]">Nome</dt>
                    <dd className="text-right text-[#F5F5F5]">{criada.nome}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#8A8A8A]">Telefone</dt>
                    <dd className="font-mono text-[#F5F5F5]">{criada.telefone}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#8A8A8A]">Palavra-passe</dt>
                    <dd className="font-mono text-[#F5F5F5]">{criada.palavra}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(
                        `Telefone: ${criada.telefone}\nPalavra-passe: ${criada.palavra}`
                      );
                      setCopiado(true);
                    }}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#404040] px-3 py-2 text-sm text-[#E5E5E5] hover:border-[#C9A962]"
                  >
                    <Copy className="h-4 w-4" />
                    {copiado ? "Copiado" : "Copiar acesso"}
                  </button>
                  <button
                    onClick={fechar}
                    className="rounded-lg bg-[#C9A962] px-4 py-2 text-sm font-semibold text-[#0A0A0A]"
                  >
                    Fechar
                  </button>
                </div>
                <p className="mt-3 text-[11px] text-[#525252]">
                  Entregue estes dados à pessoa. A palavra-passe pode ser mudada depois em
                  «Perfil».
                </p>
              </div>
            ) : (
              <div className="space-y-3 p-4">
                <input
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  placeholder="Nome completo"
                  className={campo}
                />
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="Telefone (+244 9xx xxx xxx)"
                  inputMode="tel"
                  className={campo}
                />
                <input
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="Palavra-passe provisória"
                  className={campo}
                />

                {provinciaFixa ? (
                  <p className="rounded-lg border border-[#262626] bg-[#0A0A0A] px-3 py-2 text-xs text-[#8A8A8A]">
                    A conta fica na sua província.
                  </p>
                ) : (
                  <select
                    value={form.provincia_id}
                    onChange={(e) => setForm({ ...form, provincia_id: e.target.value })}
                    className={campo}
                  >
                    <option value="">Sede nacional (sem província)</option>
                    {provincias.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                  </select>
                )}

                {erro && <p className="text-xs text-[#F87171]">{erro}</p>}

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={criar}
                    disabled={aGuardar}
                    className="flex-1 rounded-lg bg-[#5FBF8F] px-4 py-2.5 text-sm font-semibold text-[#07130D] transition hover:bg-[#78D6A6] disabled:opacity-50"
                  >
                    {aGuardar ? "A criar…" : "Criar conta"}
                  </button>
                  <button
                    onClick={fechar}
                    className="rounded-lg border border-[#404040] px-4 py-2.5 text-sm text-[#A3A3A3] hover:text-[#F5F5F5]"
                  >
                    Cancelar
                  </button>
                </div>

                <p className="text-[11px] text-[#525252]">
                  O vendedor de loja entra em <span className="font-mono">/loja</span> e só vê stock,
                  vendas ao balcão e encomendas da província dele.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
