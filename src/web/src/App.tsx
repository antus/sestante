/**
 * Radice dell'applicazione: sessione, instradamento fra le tre schermate e
 * notifiche.
 *
 * L'instradamento è volutamente elementare (stato + History API) perché le
 * schermate sono tre e aggiungere un router sarebbe una dipendenza per nulla.
 * Gli unici URL che contano davvero sono `/m/<id>`, quelli che si incollano in
 * una email quando si condivide una mappa.
 */
import { useCallback, useEffect, useState } from "react";
import { api, type MapSummary, type PublicUser, type ServerConfig } from "./lib/api";
import { appPath, currentRoute } from "./lib/base";
import { useI18n } from "./lib/i18n";
import { Login } from "./screens/Login";
import { Dashboard } from "./screens/Dashboard";
import { Editor } from "./screens/Editor";
import { Toast } from "./components/ui";

type Screen = { name: "loading" } | { name: "login" } | { name: "dashboard" } | { name: "editor"; map: MapSummary };

export function App() {
  const { t } = useI18n();
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: "loading" });
  // null finché il server non ha risposto: l'editor aspetta di saperlo prima
  // di montare la mappa, che con la collaborazione si apre già nella sessione.
  const [collabEnabled, setCollabEnabled] = useState<boolean | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Errore di ritorno dal giro OIDC, passato come query string dal server.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("auth_error");
    if (!code) return;
    const key = `auth.${code}` as "auth.exchange";
    const message = t(key);
    setAuthError(message === key ? t("err.generic") : message);
    window.history.replaceState(null, "", window.location.pathname);
  }, [t]);

  useEffect(() => {
    void (async () => {
      try {
        setConfig(await api.config());
      } catch {
        setConfig({
          keycloakEnabled: false,
          allowLocalSignup: true,
          orgLabel: "sestante",
          orgDomain: "example.org",
          geolibreUrl: "",
        });
      }
      try {
        const me = await api.me();
        setUser(me.user);
        await openInitialScreen();
      } catch {
        setScreen({ name: "login" });
      }
      try {
        const status = await api.collabStatus();
        setCollabEnabled(status.enabled && status.reachable);
      } catch {
        setCollabEnabled(false);
      }
    })();
    // Una sola volta all'avvio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Se l'URL è /m/<id> si apre direttamente quella mappa. */
  const openInitialScreen = async (): Promise<void> => {
    const match = /^\/m\/([\w-]+)/.exec(currentRoute());
    if (!match?.[1]) {
      setScreen({ name: "dashboard" });
      return;
    }
    try {
      const result = await api.map(match[1]);
      setScreen({ name: "editor", map: result.map });
    } catch {
      setScreen({ name: "dashboard" });
      window.history.replaceState(null, "", appPath("/"));
    }
  };

  const openMap = useCallback((map: MapSummary) => {
    setScreen({ name: "editor", map });
    window.history.pushState(null, "", appPath(`/m/${map.id}`));
  }, []);

  const backToDashboard = useCallback(() => {
    setScreen({ name: "dashboard" });
    window.history.pushState(null, "", appPath("/"));
  }, []);

  useEffect(() => {
    const onPopState = () => {
      void openInitialScreen();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const onAuthenticated = useCallback((next: PublicUser) => {
    setUser(next);
    setAuthError(null);
    void openInitialScreen();
  }, []);

  const logout = useCallback(async () => {
    // Con l'SSO va chiusa anche la sessione di Keycloak: altrimenti il pulsante
    // "Continua con SSO" farebbe rientrare senza chiedere la password, cosa che
    // su un computer condiviso non deve succedere. La rotta cancella il cookie
    // e rimanda a Keycloak, che riporta qui.
    if (user?.provider === "keycloak") {
      window.location.assign(appPath("/api/auth/keycloak/logout"));
      return;
    }
    try {
      await api.logout();
    } finally {
      setUser(null);
      setScreen({ name: "login" });
      window.history.replaceState(null, "", appPath("/"));
    }
  }, [user]);

  if (!config || screen.name === "loading") {
    return <div className="center-screen">{t("dash.loading")}</div>;
  }

  return (
    <>
      {screen.name === "login" || !user ? (
        <Login config={config} onAuthenticated={onAuthenticated} initialError={authError} />
      ) : screen.name === "dashboard" ? (
        <Dashboard
          user={user}
          config={config}
          onOpen={openMap}
          onLogout={() => void logout()}
          onToast={setToast}
        />
      ) : (
        <Editor
          map={screen.map}
          user={user}
          config={config}
          collabEnabled={collabEnabled}
          onBack={backToDashboard}
          onLogout={() => void logout()}
          onToast={setToast}
        />
      )}
      {toast ? <Toast message={toast} onDone={() => setToast(null)} /> : null}
    </>
  );
}
