/**
 * Accesso: locale (email e password) e Keycloak.
 *
 * Il pulsante SSO compare solo se il server dichiara `keycloakEnabled`, cioè
 * se ha sia l'issuer sia il client secret. Senza, la pagina resta pienamente
 * funzionante con le sole credenziali locali — che è la ragione per cui questa
 * applicazione supporta entrambi i percorsi: una postazione di test non deve
 * dipendere da un realm raggiungibile.
 */
import { useState, type FormEvent } from "react";
import { appPath } from "../lib/base";
import { api, ApiError, type PublicUser, type ServerConfig } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Icon } from "../lib/icons";
import { LanguageButton, ThemeButton } from "../components/TopBarControls";
import { THUMBS } from "../lib/thumbs";

export function Login({
  config,
  onAuthenticated,
  initialError,
}: {
  config: ServerConfig;
  onAuthenticated: (user: PublicUser) => void;
  initialError?: string | null;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("m.antonini@example.org");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === "login"
          ? await api.login(email, password)
          : await api.register(email, password, displayName);
      onAuthenticated(result.user);
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.code : "generic";
      const key = `err.${code}` as "err.generic";
      const message = t(key);
      setError(message === key ? t("err.generic") : message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-art">
        <div className="grid" />
        <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <path
            d={THUMBS.mondo}
            fill="hsl(var(--map-land))"
            stroke="hsl(var(--map-line))"
            strokeWidth={0.4}
          />
        </svg>
        <div className="login-brand">
          <span className="brand-mark">
            <Icon name="globe" size={15} />
          </span>
          <div>
            <div className="brand-name">Sestante</div>
            <div className="hint">{t("app.tagline")}</div>
          </div>
        </div>
        <div className="login-quote">
          <h2>{t("login.claim")}</h2>
          <p>{t("login.claimSub")}</p>
        </div>
      </div>

      <div className="login-pane">
        <div className="login-top">
          <LanguageButton />
          <ThemeButton />
        </div>
        <div className="login-body">
          <form className="login-card" onSubmit={submit} noValidate>
            <div>
              <h1>{mode === "login" ? t("login.title") : t("login.signup")}</h1>
              <p className="hint" style={{ margin: "4px 0 0" }}>
                {t("login.sub")}
              </p>
            </div>

            <div className="tenant">
              <Icon name="building" size={14} />
              <span>
                {t("login.tenant")} · <b className="mono">{config.orgLabel}</b>
              </span>
            </div>

            {config.keycloakEnabled ? (
              <>
                <a className="btn btn-outline btn-lg" href={appPath("/api/auth/keycloak/start?returnTo=/")}>
                  <Icon name="key" size={15} />
                  <span>{t("login.sso")}</span>
                </a>
                <div className="divider">{t("login.or")}</div>
              </>
            ) : null}

            {error ? <div className="error-box">{error}</div> : null}

            {mode === "signup" ? (
              <div className="field">
                <label className="label" htmlFor="name">
                  {t("login.name")}
                </label>
                <input
                  id="name"
                  className="input"
                  autoComplete="name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </div>
            ) : null}

            <div className="field">
              <label className="label" htmlFor="email">
                {t("login.email")}
              </label>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="password">
                {t("login.pass")}
              </label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>
              {busy ? t("login.working") : mode === "login" ? t("login.submit") : t("login.signup")}
            </button>

            {config.allowLocalSignup ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setMode(mode === "login" ? "signup" : "login");
                  setError(null);
                }}
              >
                {mode === "login" ? t("login.toSignup") : t("login.toLogin")}
              </button>
            ) : null}
          </form>
        </div>
      </div>
    </div>
  );
}
