"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRightLeft, Check, X } from "lucide-react";
import { createClientBrowser } from "@/lib/supabase-browser";

interface ProvinciaResumo {
  id: string;
  nome: string;
  delegacao_nome: string | null;
}

interface ProdutoResumo {
  id: string;
  name: string;
  provincia_id: string | null;
}

interface Transferencia {
  id: string;
  reference: string;
  quantity: number;
  status: string;
  created_at: string;
  product_id: string;
  from_provincia_id: string | null;
  to_provincia_id: string | null;
  notes: string | null;
}

const ESTADO: Record<string, string> = {
  pending: "Pendente",
  approved: "Aprovada",
  rejected: "Recusada",
  cancelled: "Cancelada",
};

const campo =
  "rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none";

export default function GestaoProvincias({
  provincias,
  produtos,
  transferencias,
  pendentes,
}: {
  provincias: ProvinciaResumo[];
  produtos: ProdutoResumo[];
  transferencias: Transferencia[];
  pendentes: number;
}) {
  const router = useRouter();
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [aGravar, setAGravar] = useState(false);

  // Delegação em edição
  const [provinciaId, setProvinciaId] = useState(provincias[0]?.id ?? "");
  const selecionada = provincias.find((p) => p.id === provinciaId);
  const [delegacao, setDelegacao] = useState(selecionada?.delegacao_nome ?? "");
  const [endereco, setEndereco] = useState("");
  const [telefone, setTelefone] = useState("");

  // Transferência
  const [produtoId, setProdutoId] = useState(produtos[0]?.id ?? "");
  const [origem, setOrigem] = useState(provincias[0]?.id ?? "");
  const [destino, setDestino] = useState(provincias[1]?.id ?? "");
  const [quantidade, setQuantidade] = useState("1");
  const [nota, setNota] = useState("");

  function escolherProvincia(id: string) {
    setProvinciaId(id);
    const p = provincias.find((x) => x.id === id);
    setDelegacao(p?.delegacao_nome ?? "");
    setEndereco("");
    setTelefone("");
  }

  async function guardarDelegacao(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setAviso("");
    if (!provinciaId) return;

    setAGravar(true);
    const supabase = createClientBrowser();
    const { error } = await supabase
      .from("provincias")
      .update({
        delegacao_nome: delegacao.trim() || null,
        delegacao_endereco: endereco.trim() || null,
        delegacao_telefone: telefone.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", provinciaId);

    setAGravar(false);
    if (error) {
      setErro(error.message);
      return;
    }
    setAviso("Delegação atualizada.");
    router.refresh();
  }

  async function pedirTransferencia(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setAviso("");

    const qty = Number(quantidade);
    if (!produtoId || !origem || !destino) {
      setErro("Escolha o produto e as duas províncias.");
      return;
    }
    if (origem === destino) {
      setErro("A origem e o destino têm de ser diferentes.");
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setErro("Quantidade inválida.");
      return;
    }

    setAGravar(true);
    const supabase = createClientBrowser();
    const { error } = await supabase.rpc("request_stock_transfer", {
      p_product_id: produtoId,
      p_from: origem,
      p_to: destino,
      p_quantity: qty,
      p_notes: nota.trim() || null,
    });
    setAGravar(false);

    if (error) {
      setErro(error.message);
      return;
    }
    setAviso("Transferência pedida. Fica pendente até aprovação nacional.");
    setNota("");
    router.refresh();
  }

  async function decidir(id: string, aprovar: boolean) {
    setErro("");
    setAviso("");
    setAGravar(true);
    const supabase = createClientBrowser();
    const { error } = await supabase.rpc("decide_stock_transfer", {
      p_transfer_id: id,
      p_approve: aprovar,
    });
    setAGravar(false);
    if (error) {
      setErro(error.message);
      return;
    }
    setAviso(aprovar ? "Transferência aprovada." : "Transferência recusada.");
    router.refresh();
  }

  const nome = (id: string | null) =>
    id ? (provincias.find((p) => p.id === id)?.nome ?? "—") : "Armazém-sede";
  const nomeProduto = (id: string) => produtos.find((p) => p.id === id)?.name ?? "—";

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {erro && (
        <div className="rounded-lg bg-red-950/50 p-3 text-sm text-red-200 lg:col-span-2">{erro}</div>
      )}
      {aviso && (
        <div className="rounded-lg bg-green-950/50 p-3 text-sm text-green-200 lg:col-span-2">
          {aviso}
        </div>
      )}

      <section className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
        <h2 className="mb-4 text-lg font-medium text-[#F5F5F5]">Dados da delegação</h2>
        <form onSubmit={guardarDelegacao} className="space-y-3">
          <select value={provinciaId} onChange={(e) => escolherProvincia(e.target.value)} className={`w-full ${campo}`}>
            {provincias.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
          <input
            value={delegacao}
            onChange={(e) => setDelegacao(e.target.value)}
            placeholder="Nome da delegação"
            className={`w-full ${campo}`}
          />
          <input
            value={endereco}
            onChange={(e) => setEndereco(e.target.value)}
            placeholder="Endereço"
            className={`w-full ${campo}`}
          />
          <input
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            placeholder="Telefone"
            className={`w-full ${campo}`}
          />
          <button
            type="submit"
            disabled={aGravar}
            className="rounded-lg bg-[#C9A962] px-4 py-2 text-sm font-medium text-[#0A0A0A] transition hover:bg-[#E3D5A7] disabled:opacity-60"
          >
            Guardar delegação
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6">
        <h2 className="mb-1 flex items-center gap-2 text-lg font-medium text-[#F5F5F5]">
          <ArrowRightLeft className="h-4 w-4 text-[#C9A962]" /> Transferir stock
        </h2>
        <p className="mb-4 text-xs text-[#6F6F6F]">
          A transferência só move quantidades depois de aprovada pela administração nacional.
        </p>
        <form onSubmit={pedirTransferencia} className="space-y-3">
          <select value={produtoId} onChange={(e) => setProdutoId(e.target.value)} className={`w-full ${campo}`}>
            {produtos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <select value={origem} onChange={(e) => setOrigem(e.target.value)} className={campo}>
              {provincias.map((p) => (
                <option key={p.id} value={p.id}>
                  De: {p.nome}
                </option>
              ))}
            </select>
            <select value={destino} onChange={(e) => setDestino(e.target.value)} className={campo}>
              {provincias.map((p) => (
                <option key={p.id} value={p.id}>
                  Para: {p.nome}
                </option>
              ))}
            </select>
          </div>
          <input
            type="number"
            min={1}
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            placeholder="Quantidade"
            className={`w-full ${campo}`}
          />
          <input
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Nota (opcional)"
            className={`w-full ${campo}`}
          />
          <button
            type="submit"
            disabled={aGravar}
            className="rounded-lg border border-[#C9A962] px-4 py-2 text-sm font-medium text-[#C9A962] transition hover:bg-[#C9A962] hover:text-[#0A0A0A] disabled:opacity-60"
          >
            Pedir transferência
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-6 lg:col-span-2">
        <h2 className="mb-1 text-lg font-medium text-[#F5F5F5]">Transferências</h2>
        <p className="mb-4 text-xs text-[#6F6F6F]">
          {pendentes > 0 ? `${pendentes} à espera de decisão.` : "Sem pedidos pendentes."}
        </p>

        {transferencias.length === 0 ? (
          <p className="text-sm text-[#8A8A8A]">Ainda não há transferências registadas.</p>
        ) : (
          <div className="tabela-deslizante">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-[#5A5A5A]">
                <tr>
                  <th className="py-2 pr-4 font-normal">Referência</th>
                  <th className="py-2 pr-4 font-normal">Produto</th>
                  <th className="py-2 pr-4 font-normal">Percurso</th>
                  <th className="py-2 pr-4 text-right font-normal">Qtd.</th>
                  <th className="py-2 pr-4 font-normal">Estado</th>
                  <th className="py-2 text-right font-normal">Acções</th>
                </tr>
              </thead>
              <tbody>
                {transferencias.map((t) => (
                  <tr key={t.id} className="border-t border-[#242424]">
                    <td className="py-3 pr-4 font-mono text-xs text-[#8A8A8A]">{t.reference}</td>
                    <td className="py-3 pr-4 text-[#F5F5F5]">{nomeProduto(t.product_id)}</td>
                    <td className="py-3 pr-4 text-[#A3A3A3]">
                      {nome(t.from_provincia_id)} → {nome(t.to_provincia_id)}
                    </td>
                    <td className="py-3 pr-4 text-right text-[#A3A3A3]">{t.quantity}</td>
                    <td className="py-3 pr-4">
                      <span
                        className={
                          t.status === "pending"
                            ? "text-[#C9A962]"
                            : t.status === "approved"
                              ? "text-[#16A34A]"
                              : "text-[#DC2626]"
                        }
                      >
                        {ESTADO[t.status] ?? t.status}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      {t.status === "pending" && (
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => decidir(t.id, true)}
                            disabled={aGravar}
                            className="inline-flex items-center gap-1 rounded border border-[#16A34A]/40 px-2 py-1 text-xs text-[#16A34A] transition hover:bg-[#16A34A]/10 disabled:opacity-50"
                          >
                            <Check className="h-3 w-3" /> Aprovar
                          </button>
                          <button
                            onClick={() => decidir(t.id, false)}
                            disabled={aGravar}
                            className="inline-flex items-center gap-1 rounded border border-[#DC2626]/40 px-2 py-1 text-xs text-[#DC2626] transition hover:bg-[#DC2626]/10 disabled:opacity-50"
                          >
                            <X className="h-3 w-3" /> Recusar
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
