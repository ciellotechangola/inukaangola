import Link from "next/link";
import { redirect } from "next/navigation";
import { createClientServer } from "@/lib/supabase-server";
import { getProfile } from "@/lib/auth";
import { listarProvincias } from "@/lib/provincias";
import FotoPerfil from "@/components/FotoPerfil";
import TabelaResponsiva from "@/components/TabelaResponsiva";
import AtribuirColaborador from "./AtribuirColaborador";
import EditarCliente from "./EditarCliente";
import NovoCliente from "./NovoCliente";
import ProvinciaSelect from "../colaboradores/ProvinciaSelect";

export const dynamic = "force-dynamic";

interface Perfil {
  id: string;
  full_name: string;
  phone: string | null;
  neighborhood: string | null;
  is_active: boolean;
  created_at: string;
  provincia_id: string | null;
  referencia: string | null;
  avatar_url: string | null;
}

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await getProfile();
  if (!profile || profile.role !== "manager") redirect("/");

  const sp = await searchParams;
  const procura = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim().toLowerCase() ?? "";

  const supabase = await createClientServer();
  const nacional = profile.is_national_admin || profile.provincia_id === null;

  const [clientesRes, vendedoresRes, vinculosRes, provincias] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, phone, neighborhood, is_active, created_at, provincia_id, referencia, avatar_url")
      .eq("role", "customer")
      .order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "seller")
      .order("full_name"),
    supabase
      .from("seller_customers")
      .select("customer_id, seller_id, is_active, assigned_by, assigned_at"),
    listarProvincias(supabase),
  ]);

  const clientes = (clientesRes.data ?? []) as Perfil[];
  const vendedores = (vendedoresRes.data ?? []) as { id: string; full_name: string }[];
  const vinculos = (vinculosRes.data ?? []) as {
    customer_id: string;
    seller_id: string;
    is_active: boolean;
    assigned_by: string | null;
    assigned_at: string | null;
  }[];

  // Um cliente tem no máximo um colaborador activo.
  const colaboradorDe = new Map<string, string>();
  const vinculoDe = new Map<string, { assigned_by: string | null; assigned_at: string | null }>();
  for (const v of vinculos) {
    if (v.is_active) {
      colaboradorDe.set(v.customer_id, v.seller_id);
      vinculoDe.set(v.customer_id, { assigned_by: v.assigned_by, assigned_at: v.assigned_at });
    }
  }
  const nomeVendedor = new Map(vendedores.map((v) => [v.id, v.full_name]));
  const nomePessoa = new Map<string, string>([
    ...vendedores.map((v) => [v.id, v.full_name] as [string, string]),
    [profile.id, profile.full_name],
  ]);

  const visiveis = procura
    ? clientes.filter(
        (c) =>
          c.full_name.toLowerCase().includes(procura) ||
          (c.phone ?? "").toLowerCase().includes(procura)
      )
    : clientes;

  const semColaborador = clientes.filter((c) => !colaboradorDe.has(c.id)).length;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <Link href="/gerente" className="mb-6 inline-block text-sm text-[#A3A3A3] hover:text-[#C9A962]">
        ← Painel de gestão
      </Link>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-light text-[#F5F5F5]">Clientes</h1>
          <p className="mt-1 text-sm text-[#A3A3A3]">
            {clientes.length} {clientes.length === 1 ? "cliente" : "clientes"} ·{" "}
            {clientes.length - semColaborador} com colaborador · {semColaborador} sem colaborador
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form className="flex gap-2">
            <input
              name="q"
              defaultValue={procura}
              placeholder="Nome ou telefone"
              className="w-48 rounded-lg border border-[#404040] bg-[#0A0A0A] px-3 py-2 text-sm text-[#F5F5F5] placeholder:text-[#525252] focus:border-[#C9A962] focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-lg border border-[#C9A962] px-4 py-2 text-sm text-[#C9A962] transition hover:bg-[#C9A962] hover:text-[#0A0A0A]"
            >
              Procurar
            </button>
          </form>
          <NovoCliente provincias={provincias} provinciaFixa={nacional ? null : profile.provincia_id} />
        </div>
      </div>

      {clientesRes.error && (
        <div className="mb-4 rounded-lg bg-red-950/50 p-3 text-sm text-red-200">
          {clientesRes.error.message}
        </div>
      )}

      {visiveis.length === 0 ? (
        <div className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-10 text-center">
          <p className="text-[#A3A3A3]">
            {procura ? "Nenhum cliente corresponde à procura." : "Ainda não há clientes registados."}
          </p>
        </div>
      ) : (
        <TabelaResponsiva
          itens={visiveis}
          chaveDe={(c) => c.id}
          minimo={760}
          colunas={[
            {
              chave: "cliente",
              rotulo: "Cliente",
              titulo: true,
              celula: (c) => (
                <div className="flex items-center gap-3">
                  <FotoPerfil userId={c.id} nome={c.full_name} url={c.avatar_url} podeEditar compacto />
                  <div className="min-w-0">
                    <p className="text-[#F5F5F5]">{c.full_name}</p>
                    <p className="text-[11px] text-[#525252]">
                      desde {new Date(c.created_at).toLocaleDateString("pt-PT")}
                      {!c.is_active && " · inativo"}
                    </p>
                    <div className="mt-1">
                      <EditarCliente cliente={c} provincias={provincias} podeMudarProvincia={nacional} />
                    </div>
                  </div>
                </div>
              ),
            },
            {
              chave: "telefone",
              rotulo: "Telefone",
              celula: (c) => <span className="text-[#A3A3A3]">{c.phone ?? "—"}</span>,
            },
            {
              chave: "bairro",
              rotulo: "Bairro",
              celula: (c) => <span className="text-[#A3A3A3]">{c.neighborhood ?? "—"}</span>,
            },
            {
              chave: "provincia",
              rotulo: "Província",
              celula: (c) => (
                <ProvinciaSelect
                  userId={c.id}
                  atual={c.provincia_id}
                  provincias={provincias}
                  desativado={!nacional}
                />
              ),
            },
            {
              chave: "colaborador",
              rotulo: "Colaborador",
              alinhar: "direita",
              celula: (c) => {
                const vendedorId = colaboradorDe.get(c.id) ?? null;
                const vinculo = vinculoDe.get(c.id);
                return vendedores.length === 0 ? (
                  <span className="text-xs text-[#525252]">sem colaboradores criados</span>
                ) : (
                  <AtribuirColaborador
                    clienteId={c.id}
                    vendedorAtual={vendedorId}
                    vendedores={vendedores}
                    ligadoPor={vinculo?.assigned_by ? nomePessoa.get(vinculo.assigned_by) ?? null : null}
                    ligadoEm={vinculo?.assigned_at ?? null}
                  />
                );
              },
            },
          ]}
        />
      )}

      <p className="mt-6 text-xs text-[#525252]">
        O vínculo guarda-se em <code className="text-[#6F6F6F]">seller_customers</code>. Um cliente
        tem no máximo um colaborador activo; trocar substitui o anterior.
        {vendedores.length === 0 && " Crie primeiro um colaborador em Colaboradores."}
        {vendedores.length > 0 && (
          <>
            {" "}
            Actualmente: {[...nomeVendedor.values()].join(", ") || "nenhum"}.
          </>
        )}
      </p>
    </main>
  );
}
