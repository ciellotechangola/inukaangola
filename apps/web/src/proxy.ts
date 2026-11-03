import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_ROUTES = [
  "/",
  "/catalogo",
  "/produto",
  "/carrinho",
  "/promocoes",
  "/login",
  "/registo",
  "/sobre",
  "/contactos",
  "/privacidade",
  // Candidatura a revendedor: quem chega aqui pode nem ter conta — é o
  // formulário que a própria pessoa preenche antes de ser colaborador.
  "/revendedor",
];

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // As rotas de API fazem a sua própria validação de autenticação.
  // Redireccioná-las para /login devolveria HTML a um cliente que espera JSON.
  if (pathname.startsWith("/api/")) {
    return NextResponse.next({ request });
  }

  const response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));

  if (!user && !isPublic) {
    const redirect = new URL("/login", request.url);
    redirect.searchParams.set("redirect", pathname);
    return NextResponse.redirect(redirect);
  }

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const role = profile?.role || "customer";

    // Cada perfil tem a sua área. Em vez de mandar toda a gente para a home
    // (o que parece um erro), encaminhamos para o painel que lhe pertence.
    const AREA: Record<string, string> = {
      customer: "/cliente",
      seller: "/vendedor",
      manager: "/gerente",
    };
    const destino = AREA[role] ?? "/";

    if (pathname.startsWith("/cliente") && role !== "customer" && role !== "manager") {
      return NextResponse.redirect(new URL(destino, request.url));
    }
    if (pathname.startsWith("/vendedor") && role !== "seller" && role !== "manager") {
      return NextResponse.redirect(new URL(destino, request.url));
    }
    if (pathname.startsWith("/gerente") && role !== "manager") {
      return NextResponse.redirect(new URL(destino, request.url));
    }
    // O estúdio é ferramenta de gestão: colaboradores e clientes não entram.
    if (pathname.startsWith("/designer") && role !== "manager") {
      return NextResponse.redirect(new URL(destino, request.url));
    }
  }

  return response;
}

export const config = {
  // Ficheiros de metadados servidos de /public, fora do alcance do proxy.
  //
  // O `manifest.json` é lido pelo Safari e pelo Chrome para saber o nome, os
  // ícones, o `display` e o `start_url` da aplicação instalada. Passando pelo
  // proxy era redireccionado para /login (307), o telefone ficava sem manifesto
  // e o ícone no ecrã principal abria sem sessão — apanhando o portão de acesso
  // do alojamento (403). As imagens já estavam excluídas pela extensão; estes
  // ficheiros não têm extensão de imagem, por isso ficam nomeados à mão.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|manifest.webmanifest|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2)$).*)",
  ],
};
