/**
 * Dialogo di condivisione: inviti per email con ruolo, cambio ruolo, revoca e
 * accesso generale.
 *
 * Ogni azione passa dal server, che ricalcola i permessi: qui non c'è alcuna
 * logica di autorizzazione, solo la sua rappresentazione. `canManage` arriva
 * dall'ACL e disabilita i controlli per chi non è proprietario — ma anche se
 * qualcuno li riabilitasse dagli strumenti del browser, il server risponderebbe
 * `owner-only`.
 */
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type MapSummary, type ShareState } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Icon } from "../lib/icons";
import { Avatar } from "./ui";

export function ShareDialog({
  map,
  orgLabel,
  orgDomain,
  onClose,
  onToast,
  onChanged,
}: {
  map: MapSummary;
  orgLabel: string;
  orgDomain: string;
  onClose: () => void;
  onToast: (message: string) => void;
  onChanged?: () => void;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<ShareState | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setState(await api.shares(map.id));
    } catch {
      setError(t("err.generic"));
    }
  }, [map.id, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const translateError = (cause: unknown): string => {
    const code = cause instanceof ApiError ? cause.code : "generic";
    const key = `err.${code}` as "err.generic";
    const message = t(key);
    return message === key ? t("err.generic") : message;
  };

  const submitInvite = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.invite(map.id, email.trim(), role);
      setEmail("");
      await reload();
      onChanged?.();
      onToast(t("toast.invited", result.user.displayName));
    } catch (cause) {
      setError(translateError(cause));
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (shareId: string, next: string) => {
    try {
      if (next === "remove") {
        await api.removeShare(map.id, shareId);
        onToast(t("toast.removed"));
      } else {
        await api.setShareRole(map.id, shareId, next as "viewer" | "editor");
        onToast(t("toast.roleChanged"));
      }
      await reload();
      onChanged?.();
    } catch (cause) {
      setError(translateError(cause));
    }
  };

  const changeAccess = async (access: string, generalRole: string) => {
    try {
      await api.setAccess(
        map.id,
        access as "private" | "org" | "link",
        generalRole as "viewer" | "editor",
      );
      await reload();
      onChanged?.();
    } catch (cause) {
      setError(translateError(cause));
    }
  };

  const copyLink = async () => {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.shareUrl);
      onToast(t("toast.copied"));
    } catch {
      // Clipboard negata (contesto non sicuro o permesso rifiutato): il link
      // resta comunque visibile e selezionabile nel riquadro.
      onToast(state.shareUrl);
    }
  };

  const canManage = state?.canManage ?? false;

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={t("share.title", map.name)}>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <h2>{t("share.title", map.name)}</h2>
            <p className="sub">{t("share.sub")}</p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            onClick={onClose}
            title={t("common.close")}
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        {error ? <div className="error-box">{error}</div> : null}
        {state && !canManage ? <div className="hint">{t("share.readonlyNote")}</div> : null}

        {canManage ? (
          <div className="field">
            <label className="label" htmlFor="invite-mail">
              {t("share.invite")}
            </label>
            <div className="row">
              <input
                id="invite-mail"
                className="input"
                type="email"
                style={{ flex: 1 }}
                placeholder={`nome.cognome@${orgDomain || "example.org"}`}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && void submitInvite()}
              />
              <select
                className="select"
                style={{ width: "auto", minWidth: 128 }}
                value={role}
                onChange={(event) => setRole(event.target.value as "viewer" | "editor")}
              >
                <option value="viewer">{t("role.viewerLong")}</option>
                <option value="editor">{t("role.editorLong")}</option>
              </select>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !email.trim()}
                onClick={() => void submitInvite()}
              >
                {t("share.send")}
              </button>
            </div>
          </div>
        ) : null}

        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            {t("share.people")}
          </div>

          {state?.owner ? (
            <div className="person">
              <Avatar name={state.owner.displayName} color={state.owner.color} large />
              <div className="who">
                <div className="nm">{state.owner.displayName}</div>
                <div className="em mono">{state.owner.email}</div>
              </div>
              <span className="badge badge-owner">{t("role.owner")}</span>
            </div>
          ) : null}

          {state?.people.map((person) => (
            <div className="person" key={person.shareId}>
              <Avatar name={person.user.displayName} color={person.user.color} large />
              <div className="who">
                <div className="nm">{person.user.displayName}</div>
                <div className="em mono">{person.user.email}</div>
              </div>
              {canManage ? (
                <select
                  className="select"
                  value={person.role}
                  onChange={(event) => void changeRole(person.shareId, event.target.value)}
                >
                  <option value="viewer">{t("role.viewerLong")}</option>
                  <option value="editor">{t("role.editorLong")}</option>
                  <option value="remove">{t("share.remove")}</option>
                </select>
              ) : (
                <span className={`badge badge-${person.role}`}>{t(`role.${person.role}`)}</span>
              )}
            </div>
          ))}
        </div>

        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            {t("share.general")}
          </div>
          <div className="row" style={{ marginBottom: 8 }}>
            <select
              className="select"
              style={{ flex: 1 }}
              disabled={!canManage}
              value={state?.generalAccess ?? "private"}
              onChange={(event) =>
                void changeAccess(event.target.value, state?.generalRole ?? "viewer")
              }
            >
              <option value="private">{t("share.private")}</option>
              <option value="org">{t("share.org", orgLabel)}</option>
              <option value="link">{t("share.link")}</option>
            </select>
            <select
              className="select"
              style={{ width: "auto", minWidth: 128 }}
              disabled={!canManage || state?.generalAccess === "private"}
              value={state?.generalRole ?? "viewer"}
              onChange={(event) =>
                void changeAccess(state?.generalAccess ?? "private", event.target.value)
              }
            >
              <option value="viewer">{t("role.viewerLong")}</option>
              <option value="editor">{t("role.editorLong")}</option>
            </select>
          </div>
          <div className="linkbox">
            <Icon name="link" size={14} />
            <span className="url mono">{state?.shareUrl ?? "…"}</span>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => void copyLink()}>
              {t("share.copy")}
            </button>
          </div>
        </div>

        <div className="row">
          <div className="spacer" />
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {t("common.done")}
          </button>
        </div>
      </div>
    </div>
  );
}
