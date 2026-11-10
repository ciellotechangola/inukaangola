import { permanentRedirect } from "next/navigation";

/**
 * `/vendedor/perfil` deixou de existir como tela.
 *
 * Os dados pessoais e profissionais passaram para a Área de Colaborador —
 * eram duas páginas a mostrar a mesma identidade, os mesmos indicadores e a
 * mesma referência. O endereço fica aqui só para não dar 404 a um favorito ou
 * a um link antigo; o 308 ensina o browser (e o Google) o caminho novo.
 */
export default function PerfilAntigoPage() {
  permanentRedirect("/vendedor");
}
