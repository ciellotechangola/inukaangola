import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

export const supabaseAdmin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-key", {
  auth: { autoRefreshToken: false, persistSession: false },
});

export async function createClientServer() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // `cookies().set()` só é permitido em Server Actions e Route
          // Handlers. Num Server Component (o caso de todas as páginas deste
          // site) lança:
          //   "Cookies can only be modified in a Server Action or Route Handler"
          // O `@supabase/ssr` chama `setAll` sempre que renova um token
          // expirado, por isso um simples carregamento de página com sessão
          // antiga dava HTTP 500.
          //
          // Ignorar aqui é seguro porque o proxy (middleware) corre antes de
          // cada pedido e é ele que grava os cookies renovados na resposta.
          // É o padrão que a documentação do @supabase/ssr recomenda quando
          // existe middleware a renovar a sessão.
        }
      },
    },
  });
}
