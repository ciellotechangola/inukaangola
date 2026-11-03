"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClientBrowser } from "@/lib/supabase-browser";
import { phoneToEmail } from "@/lib/phone-email";
import { listarProvincias, type Provincia } from "@/lib/provincias";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    email: "",
    neighborhood: "",
    provincia: "",
    password: "",
    confirmPassword: "",
  });
  const [provincias, setProvincias] = useState<Provincia[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // A província define a delegação que acompanha o cliente. É opcional:
  // sem ela, a conta fica nacional até a gerência atribuir.
  useEffect(() => {
    listarProvincias(createClientBrowser()).then(setProvincias);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (form.password !== form.confirmPassword) {
      setError("As palavras-passe não coincidem.");
      setLoading(false);
      return;
    }

    const supabase = createClientBrowser();

    // O registo é feito no servidor (Admin API): ver /api/auth/registo.
    // O cliente nunca chama signUp — os emails são sintéticos e a
    // confirmação por email tornaria a conta inutilizável.
    const response = await fetch("/api/auth/registo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full_name: form.full_name,
        phone: form.phone,
        email: form.email,
        neighborhood: form.neighborhood,
        provincia: form.provincia,
        password: form.password,
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      setError(result.error || "Não foi possível criar a conta.");
      setLoading(false);
      return;
    }

    // Sessão imediata após criação da conta
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: phoneToEmail(form.phone),
      password: form.password,
    });

    if (signInError) {
      setError("Conta criada, mas não foi possível iniciar sessão. Vá a Entrar.");
      setLoading(false);
      return;
    }

    router.push("/cliente");
    router.refresh();
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-[#262626] bg-[#1A1A1A] p-8">
        <h1 className="mb-2 text-2xl font-light text-[#F5F5F5]">Criar conta</h1>
        <p className="mb-6 text-sm text-[#A3A3A3]">Junte-se à comunidade INUKA Angola</p>

        {error && (
          <div className="mb-4 rounded-lg bg-red-950/50 p-3 text-sm text-red-200">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            name="full_name"
            value={form.full_name}
            onChange={handleChange}
            placeholder="Nome completo"
            className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-4 py-3 text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
            required
          />
          <input
            name="phone"
            value={form.phone}
            onChange={handleChange}
            placeholder="Telefone (+244 9xx xxx xxx)"
            className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-4 py-3 text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
            required
          />
          <input
            name="email"
            type="email"
            value={form.email}
            onChange={handleChange}
            placeholder="E-mail (opcional)"
            className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-4 py-3 text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
          />
          <input
            name="neighborhood"
            value={form.neighborhood}
            onChange={handleChange}
            placeholder="Bairro"
            className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-4 py-3 text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
          />
          <select
            name="provincia"
            value={form.provincia}
            onChange={handleChange}
            className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-4 py-3 text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
          >
            <option value="">Província (opcional)</option>
            {provincias.map((p) => (
              <option key={p.id} value={p.slug}>
                {p.nome}
              </option>
            ))}
          </select>
          <input
            name="password"
            type="password"
            value={form.password}
            onChange={handleChange}
            placeholder="Palavra-passe"
            className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-4 py-3 text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
            required
            minLength={6}
          />
          <input
            name="confirmPassword"
            type="password"
            value={form.confirmPassword}
            onChange={handleChange}
            placeholder="Confirmar palavra-passe"
            className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-4 py-3 text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[#C9A962] py-3 font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-60"
          >
            {loading ? "A criar..." : "Criar conta"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[#A3A3A3]">
          Já tem conta?{" "}
          <Link href="/login" className="text-[#C9A962] hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </main>
  );
}
