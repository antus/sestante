/**
 * I tre controlli che stanno a destra in ogni schermata: lingua, tema, account.
 *
 * Sono gli stessi in login, dashboard ed editor di proposito — lingua e tema si
 * devono poter cambiare anche prima di autenticarsi, ed è la posizione in cui
 * GeoLibre stessa tiene il suo interruttore del tema.
 */
import { useI18n, type Locale } from "../lib/i18n";
import { useTheme } from "../lib/theme";
import type { Accent, ThemeMode } from "../lib/prefs";
import { Icon } from "../lib/icons";
import { MenuHeading, MenuItem, MenuSeparator, Popover, usePopover, Avatar } from "./ui";
import type { PublicUser } from "../lib/api";

const ACCENTS: { id: Accent; swatch: string }[] = [
  { id: "blue", swatch: "hsl(221.2 83.2% 53.3%)" },
  { id: "violet", swatch: "hsl(262.1 83.3% 57.8%)" },
  { id: "emerald", swatch: "hsl(142.1 76.2% 36.3%)" },
  { id: "rose", swatch: "hsl(346.8 77.2% 49.8%)" },
  { id: "amber", swatch: "hsl(24.6 95% 53.1%)" },
];

export function LanguageButton() {
  const { locale, setLocale, t } = useI18n();
  const { anchor, toggle, close } = usePopover();

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={toggle}
        aria-haspopup="menu"
        title={t("lang.title")}
      >
        <Icon name="globe" />
        <span style={{ fontWeight: 600 }}>{locale.toUpperCase()}</span>
      </button>
      {anchor ? (
        <Popover anchor={anchor} onClose={close}>
          <MenuHeading>{t("lang.title")}</MenuHeading>
          {(["it", "en"] as Locale[]).map((value) => (
            <MenuItem
              key={value}
              label={t(value === "it" ? "lang.it" : "lang.en")}
              hint={value.toUpperCase()}
              checked={locale === value}
              onSelect={() => {
                setLocale(value);
                close();
              }}
            />
          ))}
          <MenuSeparator />
          <div className="hint" style={{ padding: "2px 8px 6px", maxWidth: 210 }}>
            {t("lang.note")}
          </div>
        </Popover>
      ) : null}
    </>
  );
}

export function ThemeButton() {
  const { mode, accent, setMode, setAccent } = useTheme();
  const { t } = useI18n();
  const { anchor, toggle, close } = usePopover();
  const icon = mode === "system" ? "monitor" : mode === "dark" ? "moon" : "sun";

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-icon"
        onClick={toggle}
        aria-haspopup="menu"
        title={t("theme.title")}
      >
        <Icon name={icon} />
      </button>
      {anchor ? (
        <Popover anchor={anchor} onClose={close}>
          <MenuHeading>{t("theme.mode")}</MenuHeading>
          {(
            [
              ["light", "sun"],
              ["dark", "moon"],
              ["system", "monitor"],
            ] as [ThemeMode, "sun" | "moon" | "monitor"][]
          ).map(([value, iconName]) => (
            <MenuItem
              key={value}
              label={t(`theme.${value}` as "theme.light")}
              icon={iconName}
              checked={mode === value}
              onSelect={() => setMode(value)}
            />
          ))}
          <MenuSeparator />
          <MenuHeading>{t("theme.scheme")}</MenuHeading>
          <div className="swatches">
            {ACCENTS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="swatch-btn"
                style={{ background: item.swatch }}
                aria-pressed={accent === item.id}
                title={t(`scheme.${item.id}` as "scheme.blue")}
                onClick={() => setAccent(item.id)}
              />
            ))}
          </div>
        </Popover>
      ) : null}
    </>
  );
}

export function UserButton({ user, onLogout }: { user: PublicUser; onLogout: () => void }) {
  const { t } = useI18n();
  const { anchor, toggle, close } = usePopover();

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        onClick={toggle}
        aria-haspopup="menu"
        aria-label={user.displayName}
      >
        <Avatar name={user.displayName} color={user.color} />
      </button>
      {anchor ? (
        <Popover anchor={anchor} onClose={close}>
          <MenuHeading>{user.displayName}</MenuHeading>
          <div className="hint mono" style={{ padding: "0 8px 6px" }}>
            {user.email}
          </div>
          <div className="hint" style={{ padding: "0 8px 6px" }}>
            {user.provider === "keycloak" ? "Keycloak SSO" : "Account locale"}
          </div>
          <MenuSeparator />
          <MenuItem label={t("user.settings")} icon="settings" onSelect={close} />
          <MenuItem
            label={t("user.logout")}
            icon="logout"
            onSelect={() => {
              close();
              onLogout();
            }}
          />
        </Popover>
      ) : null}
    </>
  );
}
