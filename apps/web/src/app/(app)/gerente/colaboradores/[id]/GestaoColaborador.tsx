"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  KeyRound,
  Pencil,
  Power,
  Target,
  UserMinus,
  X,
} from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";
import { formatCurrency } from "@/lib/utils";
import { mensagemErro } from "@/lib/colaborador";
import type { Provincia } from "@/lib/provincias";

interface Inicial {
  full_name: string;
  bi_number: string | null;
  birth_date: string | null;
  whatsapp: string | null;
  address: string | null;
  municipio: string | null;
  job_title: string | null;
  category: string | null;
  hired_at: string | null;
  /** Taxa pessoal. `null` = herda a taxa da empresa. */
  commission_rate: number | null;
  is_active: boolean;
}

/**
 * Acções da gestão sobre a ficha de um colaborador.
 *
 * Tudo passa por RPC ou pelo RLS — a verificação de papel e de província é
 * feita na base de dados. A fotografia fica no cartão de identidade, que é
 * onde ela se vê.
 */
export default function GestaoColaborador({
  id,
  referencia,
  provinciaId,
  provincias,
  podeEscolherProvincia,
  inicial,
  comissaoPendente,
  metaAtual,
}: {
  id: string;
  referencia: string | null;
  provinciaId: string | null;
  provincias: Provincia[];
  podeEscolherProvincia: boolean;
  inicial: Inicial;
  comissaoPendente: number;
  metaAtual: { valor: number; vendas: number } | null;
}) {
  const router = useRouter();
  const [painel, setPainel] = useState<"nenhum" | "dados" | "meta" | "acesso">("nenhum");
  const [aGuardar, setAGuardar] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  const [form, setForm] = useState({
    full_name: inicial.full_name,
    bi_number: inicial.bi_number ?? "",
    birth_date: inicial.birth_date ?? "",
    whatsapp: inicial.whatsapp ?? "",
    address: inicial.address ?? "",
    municipio: inicial.municipio ?? "",
    job_title: inicial.job_title ?? "",
    category: inicial.category ?? "",
    hired_at: inicial.hired_at ?? "",
    // Vazio = herda a taxa da empresa. Um 0 explícito é uma decisão diferente.
    commission_rate:
      inicial.commission_rate === null ? "" : String(Number((inicial.commission_rate * 100).toFixed(2))),
    is_active: inicial.is_active,
  });

  const [meta, setMeta] = useState({
    valor: metaAtual?.valor ? String(metaAtual.valor) : "",
    vendas: metaAtual?.vendas ? String(metaAtual.vendas) : "",
  });

  const [refEdit, setRefEdit] = useState(referencia ?? "");

  function limpar() {
    setErro("");
    setAviso("");
  }

  async function guardarDados() {
    setAGuardar(true);
    limpar();

    const supabase = createClientBrowser();
    const { error } = await supabase.rpc("atualizar_perfil_colaborador", {
      p_id: id,
      p_campos: {
        full_name: form.full_name.trim(),
        bi_number: form.bi_number.trim(),
        birth_date: form.birth_date,
        whatsapp: form.whatsapp.trim(),
        address: form.address.trim(),
        municipio: form.municipio.trim(),
        job_title: form.job_title.trim(),
        category: form.category.trim(),
        hired_at: form.hired_at,
        is_active: form.is_active,
      },
    });

    // A taxa vai por RPC própria: aqui o vazio significa "herda", e a função
    // genérica não distingue vazio de zero.
    const texto = form.commission_rate.trim();
    const { error: erroTaxa } = await supabase.rpc("definir_taxa_colaborador", {
      p_id: id,
      p_rate: texto === "" ? null : Number(texto.replace(",", ".")) / 100,
    });

    setAGuardar(false);
    if (error) {
      setErro(mensagemErro(error));
      return;
    }
    if (erroTaxa) {
      setErro(mensagemErro(erroTaxa));
      return;
    }

    setAviso("Ficha atualizada.");
    setPainel("nenhum");
    router.refresh();
  }

  async function mudarProvincia(valor: string) {
    setAGuardar(true);
    limpar();

    const supabase = createClientBrowser();
    const { error } = await supabase.rpc("assign_province", {
      p_user_id: id,
      p_provincia_id: valor || null,
    });

    setAGuardar(false);
    if (error) {
      setErro(mensagemErro(error));
      return;
    }

    setAviso("Província atualizada. A referência acompanhou o novo prefixo.");
    router.refresh();
  }

  async function corrigirReferencia() {
    const nova = refEdit.trim().toUpperCase();
    if (!/^INK-[A-Z]{3}-\d{5}$/.test(nova)) {
      setErro("Formato inválido. Use INK-XXX-00000.");
      return;
    }
    if (
      !window.confirm(
        `Corrigir a referência para ${nova}? É o código que o colaborador usa e pode já estar impresso. A alteração fica registada na auditoria.`
      )
    ) {
      return;
    }

    setAGuardar(true);
    limpar();
    const supabase = createClientBrowser();
    const { error } = await supabase.from("profiles").update({ referencia: nova }).eq("id", id);

    setAGuardar(false);
    if (error) {
      setErro(
        error.message.includes("duplicate")
          ? "Essa referência já está atribuída a outra pessoa."
          : error.message
      );
      return;
    }

    setAviso("Referência corrigida.");
    router.refresh();
  }

  async function guardarMeta() {
    setAGuardar(true);
    limpar();

    const supabase = createClientBrowser();
    const { error } = await supabase.rpc("definir_meta", {
      p_seller_id: id,
      p_provincia_id: null,
      p_inicio: null,
      p_fim: null,
      p_valor: Number(meta.valor) || 0,
      p_vendas: Number(meta.vendas) || 0,
    });

    setAGuardar(false);
    if (error) {
      setErro(mensagemErro(error));
      return;
    }

    setAviso("Meta guardada.");
    setPainel("nenhum");
    router.refresh();
  }

  async function pagar() {
    if (!window.confirm(`Pagar ${formatCurrency(comissaoPendente)} de comissões pendentes?`)) return;

    setAGuardar(true);
    limpar();

    const supabase = createClientBrowser();
    const { data, error } = await supabase.rpc("pagar_comissoes", {
      p_seller_id: id,
      p_method: "transferencia",
      p_notes: "Pagamento registado na ficha do colaborador",
    });

    setAGuardar(false);
    if (error) {
      setErro(mensagemErro(error));
      return;
    }

    const valor = Number((data as { amount?: number } | null)?.amount ?? 0);
    setAviso(`Pagamento de ${formatCurrency(valor)} registado.`);
    router.refresh();
  }

  async function alternarEstado() {
    const novo = !inicial.is_active;
    if (!window.confirm(novo ? "Reativar o acesso deste colaborador?" : "Desativar o acesso deste colaborador? Deixa de poder entrar, mas o histórico mantém-se.")) {
      return;
    }

    setAGuardar(true);
    limpar();
    const supabase = createClientBrowser();
    const { error } = await supabase
      .from("profiles")
      .update({ is_active: novo })
      .eq("id", id);

    setAGuardar(false);
    if (error) {
      setErro(mensagemErro(error));
      return;
    }

    setForm({ ...form, is_active: novo });
    setAviso(novo ? "Colaborador reativado." : "Colaborador desativado.");
    router.refresh();
  }

  async function despromover() {
    if (
      !window.confirm(
        "Tornar este colaborador em cliente? Perde o acesso à área de colaborador. As vendas, clientes e comissões mantêm-se — só o papel muda."
      )
    ) {
      return;
    }

    setAGuardar(true);
    limpar();
    const supabase = createClientBrowser();
    const { error } = await supabase.from("profiles").update({ role: "customer" }).eq("id", id);

    setAGuardar(false);
    if (error) {
      setErro(mensagemErro(error));
      return;
    }

    // A ficha fica guardada (BI, contactos): se voltar a ser colaborador,
    // não se perde nada. O papel é que decide o acesso.
    router.push("/gerente/colaboradores");
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
      <div className="mb-4">
        <h2 className="text-sm font-medium text-[#F5F5F5]">Acções da gestão</h2>
        <p className="text-[11px] text-[#525252]">Dados, meta, comissões, província e acesso.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Botao
          ativo={painel === "dados"}
          onClick={() => {
            setPainel(painel === "dados" ? "nenhum" : "dados");
            limpar();
          }}
          icone={<Pencil className="h-3.5 w-3.5" />}
        >
          Editar ficha
        </Botao>

        <Botao
          ativo={painel === "meta"}
          onClick={() => {
            setPainel(painel === "meta" ? "nenhum" : "meta");
            limpar();
          }}
          icone={<Target className="h-3.5 w-3.5" />}
        >
          Definir meta
        </Botao>

        <Botao
          ativo={painel === "acesso"}
          onClick={() => {
            setPainel(painel === "acesso" ? "nenhum" : "acesso");
            limpar();
          }}
          icone={<KeyRound className="h-3.5 w-3.5" />}
        >
          Província e acesso
        </Botao>

        <button
          type="button"
          onClick={pagar}
          disabled={aGuardar || comissaoPendente <= 0}
          className="inline-flex items-center gap-2 rounded-lg bg-[#C9A962] px-3 py-2 text-xs font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:cursor-not-allowed disabled:bg-[#262626] disabled:text-[#6F6F6F]"
        >
          <Banknote className="h-3.5 w-3.5" />
          {comissaoPendente > 0
            ? `Pagar ${formatCurrency(comissaoPendente)}`
            : "Sem comissões a pagar"}
        </button>
      </div>

      {erro && (
        <p className="mt-3 rounded-lg border border-[#4A2020] bg-[#2A1010] px-3 py-2 text-xs text-[#F87171]">
          {erro}
        </p>
      )}
      {aviso && (
        <p className="mt-3 rounded-lg border border-[#1F4D2E] bg-[#0F2A18] px-3 py-2 text-xs text-[#4ADE80]">
          {aviso}
        </p>
      )}

      {painel === "dados" && (
        <div className="mt-4 rounded-lg border border-[#2A2A2A] bg-[#141414] p-4">
          <Cabecalho titulo="Dados do colaborador" fechar={() => setPainel("nenhum")} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Nome completo" valor={form.full_name} onChange={(v) => setForm({ ...form, full_name: v })} />
            <Campo rotulo="Nº do BI" valor={form.bi_number} onChange={(v) => setForm({ ...form, bi_number: v })} mono />
            <Campo rotulo="Data de nascimento" tipo="date" valor={form.birth_date} onChange={(v) => setForm({ ...form, birth_date: v })} />
            <Campo rotulo="Telefone / WhatsApp" valor={form.whatsapp} onChange={(v) => setForm({ ...form, whatsapp: v })} />
            <Campo rotulo="Município" valor={form.municipio} onChange={(v) => setForm({ ...form, municipio: v })} />
            <Campo rotulo="Endereço" valor={form.address} onChange={(v) => setForm({ ...form, address: v })} />
            <Campo rotulo="Função" valor={form.job_title} onChange={(v) => setForm({ ...form, job_title: v })} />
            <Campo rotulo="Categoria" valor={form.category} onChange={(v) => setForm({ ...form, category: v })} />
            <Campo rotulo="Data de entrada" tipo="date" valor={form.hired_at} onChange={(v) => setForm({ ...form, hired_at: v })} />
            <Campo
              rotulo="Comissão pessoal (%)"
              tipo="number"
              valor={form.commission_rate}
              onChange={(v) => setForm({ ...form, commission_rate: v })}
            />
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-[#525252]">
            Deixe <strong className="text-[#6F6F6F]">vazio</strong> para esta pessoa receber a
            taxa da empresa (definida em Colaboradores). Um valor aqui sobrepõe-se a essa taxa e
            aplica-se às vendas seguintes.
          </p>

          <button
            type="button"
            onClick={guardarDados}
            disabled={aGuardar}
            className="mt-3 rounded-lg bg-[#C9A962] px-3 py-2 text-xs font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-50"
          >
            {aGuardar ? "A guardar…" : "Guardar ficha"}
          </button>
        </div>
      )}

      {painel === "meta" && (
        <div className="mt-4 rounded-lg border border-[#2A2A2A] bg-[#141414] p-4">
          <Cabecalho titulo="Meta do mês corrente" fechar={() => setPainel("nenhum")} />

          <div className="flex flex-wrap items-end gap-3">
            <Campo rotulo="Valor (AOA)" tipo="number" valor={meta.valor} onChange={(v) => setMeta({ ...meta, valor: v })} />
            <Campo rotulo="Nº de vendas" tipo="number" valor={meta.vendas} onChange={(v) => setMeta({ ...meta, vendas: v })} />
            <button
              type="button"
              onClick={guardarMeta}
              disabled={aGuardar}
              className="rounded-lg bg-[#C9A962] px-3 py-2 text-xs font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-50"
            >
              {aGuardar ? "A guardar…" : "Guardar meta"}
            </button>
          </div>

          <p className="mt-3 text-[11px] text-[#525252]">
            Deixar o valor a zero remove a meta individual do mês (o colaborador passa a ver a
            meta da província, se existir).
          </p>
        </div>
      )}

      {painel === "acesso" && (
        <div className="mt-4 space-y-5 rounded-lg border border-[#2A2A2A] bg-[#141414] p-4">
          <div>
            <Cabecalho titulo="Província" fechar={() => setPainel("nenhum")} />
            <select
              value={provinciaId ?? ""}
              onChange={(e) => mudarProvincia(e.target.value)}
              disabled={aGuardar || !podeEscolherProvincia}
              className="w-full max-w-xs rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none disabled:opacity-50"
            >
              <option value="">Sem província (administração nacional)</option>
              {provincias.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome} ({p.codigo})
                </option>
              ))}
            </select>
            {!podeEscolherProvincia && (
              <p className="mt-1 text-[11px] text-[#525252]">
                Só a administração nacional muda a província de alguém.
              </p>
            )}
          </div>

          <div className="border-t border-[#262626] pt-4">
            <p className="mb-2 text-xs uppercase tracking-wide text-[#6F6F6F]">Referência</p>
            <div className="flex flex-wrap items-end gap-2">
              <input
                value={refEdit}
                onChange={(e) => setRefEdit(e.target.value.toUpperCase())}
                placeholder="INK-UIG-00001"
                className="w-48 rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2 font-mono text-xs tracking-wider text-[#F5F5F5] focus:border-[#C9A962] focus:outline-none"
              />
              <button
                type="button"
                onClick={corrigirReferencia}
                disabled={aGuardar || refEdit.trim().toUpperCase() === (referencia ?? "")}
                className="rounded-lg border border-[#333] px-3 py-2 text-xs text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962] disabled:opacity-40"
              >
                Corrigir referência
              </button>
            </div>
            <p className="mt-1 text-[11px] text-[#525252]">
              Só se for mesmo necessário: é o código que a pessoa usa e pode já estar impresso.
              A alteração fica na auditoria.
            </p>
          </div>

          <div className="border-t border-[#262626] pt-4">
            <p className="mb-2 text-xs uppercase tracking-wide text-[#6F6F6F]">Estado e acesso</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={alternarEstado}
                disabled={aGuardar}
                className="inline-flex items-center gap-2 rounded-lg border border-[#333] px-3 py-2 text-xs text-[#A3A3A3] transition hover:border-[#C9A962]/50 hover:text-[#C9A962] disabled:opacity-50"
              >
                <Power className="h-3.5 w-3.5" />
                {inicial.is_active ? "Desativar acesso" : "Reativar acesso"}
              </button>

              <button
                type="button"
                onClick={despromover}
                disabled={aGuardar}
                className="inline-flex items-center gap-2 rounded-lg border border-[#333] px-3 py-2 text-xs text-[#A3A3A3] transition hover:border-[#DC2626]/60 hover:text-[#DC2626] disabled:opacity-50"
              >
                <UserMinus className="h-3.5 w-3.5" />
                Tornar cliente
              </button>
            </div>
            <p className="mt-2 text-[11px] text-[#525252]">
              “Tornar cliente” remove o acesso à área de colaborador. As vendas, clientes e
              comissões ficam no histórico — o perfil não é apagado, porque a base de dados não
              permite apagar quem tem vendas registadas.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Botao({
  ativo,
  onClick,
  icone,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  icone: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition ${
        ativo
          ? "border-[#C9A962]/60 bg-[#C9A962]/10 text-[#C9A962]"
          : "border-[#333] text-[#A3A3A3] hover:border-[#C9A962]/50 hover:text-[#C9A962]"
      }`}
    >
      {icone}
      {children}
    </button>
  );
}

function Cabecalho({ titulo, fechar }: { titulo: string; fechar: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <p className="text-xs uppercase tracking-wide text-[#6F6F6F]">{titulo}</p>
      <button
        type="button"
        onClick={fechar}
        className="text-[#525252] transition hover:text-[#F5F5F5]"
        aria-label="Fechar"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function Campo({
  rotulo,
  valor,
  onChange,
  tipo = "text",
  mono,
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  tipo?: string;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-[#6F6F6F]">{rotulo}</span>
      <input
        type={tipo}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        min={tipo === "number" ? 0 : undefined}
        step={tipo === "number" ? "0.1" : undefined}
        className={`w-full rounded-lg border border-[#333] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none ${
          mono ? "font-mono text-xs" : ""
        }`}
      />
    </label>
  );
}
