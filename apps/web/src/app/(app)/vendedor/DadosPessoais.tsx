"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { mensagemErro } from "@/lib/colaborador";

/**
 * Edição dos dados que o próprio colaborador pode alterar.
 *
 * O BI, a função e a categoria não aparecem aqui de propósito: quem os altera
 * é a gestão, e o servidor recusa a alteração mesmo que alguém a tente enviar.
 */
export default function DadosPessoais({
  id,
  whatsapp,
  address,
  municipio,
}: {
  id: string;
  whatsapp: string | null;
  address: string | null;
  municipio: string | null;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [form, setForm] = useState({
    whatsapp: whatsapp ?? "",
    address: address ?? "",
    municipio: municipio ?? "",
  });

  async function guardar() {
    setGuardando(true);
    setErro("");
    setAviso("");

    const supabase = createClientBrowser();
    const { error } = await supabase.rpc("atualizar_perfil_colaborador", {
      p_id: id,
      p_campos: {
        whatsapp: form.whatsapp.trim(),
        address: form.address.trim(),
        municipio: form.municipio.trim(),
      },
    });

    setGuardando(false);

    if (error) {
      setErro(mensagemErro(error));
      return;
    }

    setAviso("Dados atualizados.");
    setAberto(false);
    router.refresh();
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[#333] px-3 py-1.5 text-xs text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962]"
      >
        <Pencil className="h-3 w-3" />
        Editar contactos
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-[#2A2A2A] bg-[#141414] p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-[#6F6F6F]">Contactos e morada</p>
        <button
          type="button"
          onClick={() => setAberto(false)}
          className="text-[#525252] transition hover:text-[#F5F5F5]"
          aria-label="Fechar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <label className="block">
        <span className="mb-1 block text-[11px] text-[#6F6F6F]">WhatsApp</span>
        <input
          value={form.whatsapp}
          onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
          placeholder="+244 9xx xxx xxx"
          className={campo}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-[11px] text-[#6F6F6F]">Município</span>
        <input
          value={form.municipio}
          onChange={(e) => setForm({ ...form, municipio: e.target.value })}
          placeholder="Ex.: Uíge"
          className={campo}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-[11px] text-[#6F6F6F]">Endereço</span>
        <input
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
          placeholder="Bairro, rua, referência"
          className={campo}
        />
      </label>

      {erro && <p className="text-xs text-[#F87171]">{erro}</p>}
      {aviso && <p className="text-xs text-[#4ADE80]">{aviso}</p>}

      <button
        type="button"
        onClick={guardar}
        disabled={guardando}
        className="rounded-lg bg-[#C9A962] px-3 py-1.5 text-xs font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-50"
      >
        {guardando ? "A guardar…" : "Guardar"}
      </button>
    </div>
  );
}

const campo =
  "w-full rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none";
