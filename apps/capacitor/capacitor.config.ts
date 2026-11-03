import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Endereço da aplicação web que a app iOS mostra.
 *
 * A INUKA é uma aplicação Next.js com renderização no servidor, rotas de API e
 * Supabase do lado do servidor. Não é possível "exportar para HTML" e metê-la
 * dentro do telefone sem reescrever metade do sistema. Por isso a app iOS é uma
 * janela nativa (WKWebView) sobre o mesmo servidor — a mesma base de dados, as
 * mesmas contas, as mesmas permissões. O que muda é só a embalagem: ícone no
 * ecrã principal, arranque sem barra de endereço, e um `.ipa` instalável.
 *
 * Para apontar a outro domínio (produção, ensaio) basta:
 *   INUKA_URL="https://inuka.ao" npx cap sync ios
 *
 * O `?sharecode=` não é decoração: o alojamento actual só entrega a página a
 * quem apresentar o código. Sem ele o primeiro ecrã é 403.
 */
const SITE =
  process.env.INUKA_URL ?? "https://inuka-angola.apps.workbuddy.host/?sharecode=J27FVBMTIH";

const config: CapacitorConfig = {
  appId: "ao.inuka.app",
  appName: "INUKA",
  webDir: "www",

  server: {
    url: SITE,
    // Mostrado quando não há rede. É um ficheiro local (www/offline.html),
    // por isso aparece mesmo com o servidor inalcançável.
    errorPath: "offline.html",
    cleartext: false,
  },

  ios: {
    // O site já trata das áreas seguras com `env(safe-area-inset-*)` e
    // `viewport-fit=cover`. Se o Capacitor também aplicasse margens, o
    // conteúdo ficava com o dobro do recuo.
    contentInset: "never",
    backgroundColor: "#0A0A0A",
    scheme: "INUKA",
    // A app vive num só domínio; não precisa de navegar para fora dele.
    limitsNavigationsToAppBoundDomains: false,
    webContentsDebuggingEnabled: true,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 1100,
      launchAutoHide: true,
      backgroundColor: "#0A0A0A",
      showSpinner: false,
      iosSpinnerStyle: "large",
    },
    StatusBar: {
      // `Dark` = para fundos escuros, ou seja texto claro.
      style: "Dark",
      overlaysWebView: false,
    },
    Keyboard: {
      resize: "native",
      resizeOnFullScreen: true,
    },
  },
};

export default config;
