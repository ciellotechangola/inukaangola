// Este ficheiro mantém compatibilidade e exports utilitários.
// Use supabase-browser.ts em Client Components e supabase-server.ts em Server Components.

export { createClientBrowser } from "./supabase-browser";
export { createClientServer, supabaseAdmin } from "./supabase-server";
