"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClientBrowser } from "@/lib/supabase-browser";
import { phoneToEmail } from "@/lib/phone-email";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Depois de entrar, a primeira coisa que carrega é a aba de referência
  // (província, delegação e código pessoal). Quem tem um destino explícito
  // (?redirect=...) mantém-no.
  const redirect = searchParams.get("redirect") || "/referencia";

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createClientBrowser();

    // O email é derivado do telefone de forma determinística
    // (u244900000009@inuka.ao). Não consultamos `profiles` aqui:
    // o RLS esconde os perfis a utilizadores anónimos — e essa consulta
    // permitiria a qualquer pessoa descobrir que telefones estão registados.
    const email = phoneToEmail(phone);

    if (!email) {
      setError("Telefone inválido. Use o formato +244 9xx xxx xxx.");
      setLoading(false);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(
        signInError.message.toLowerCase().includes("invalid")
          ? "Telefone ou palavra-passe incorretos."
          : signInError.message,
      );
      setLoading(false);
      return;
    }

    router.push(redirect);
    router.refresh();
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-[#262626] bg-[#1A1A1A] p-8">
        <h1 className="mb-2 text-2xl font-light text-[#F5F5F5]">Iniciar sessão</h1>
        <p className="mb-6 text-sm text-[#A3A3A3]">Aceda à sua conta INUKA Angola</p>

        {error && (
          <div className="mb-4 rounded-lg bg-red-950/50 p-3 text-sm text-red-200">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-[#A3A3A3]">Telefone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+244 9xx xxx xxx"
              className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-4 py-3 text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-[#A3A3A3]">Palavra-passe</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-[#404040] bg-[#0A0A0A] px-4 py-3 text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[#C9A962] py-3 font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-60"
          >
            {loading ? "A entrar..." : "Entrar"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[#A3A3A3]">
          Ainda não tem conta?{" "}
          <Link href="/registo" className="text-[#C9A962] hover:underline">
            Criar conta
          </Link>
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><p className="text-[#A3A3A3]">A carregar...</p></div>}>
      <LoginForm />
    </Suspense>
  );
}
