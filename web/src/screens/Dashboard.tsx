/** Elenco delle mappe: possedute, condivise, con ruolo e collaboratori. */
import { useEffect, useMemo, useState } from "react";
import { api, type MapSummary, type PublicUser, type ServerConfig } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Icon, type IconName } from "../lib/icons";
import { Avatar, MenuItem, Popover, Thumbnail } from "../components/ui";
import { LanguageButton, ThemeButton, UserButton } from "../components/TopBarControls";

type NavKey = "mine" | "shared" | "recent" | "fav" | "trash";

const NAV: { key: NavKey; icon: IconName }[] = [
  { key: "mine", icon: "map" },
  { key: "shared", icon: "users" },
  { key: "recent", icon: "clock" },
  { key: "fav", icon: "star" },
  { key: "trash", icon: "trash" },
];

export function Dashboard({
  user,
  config,
  onOpen,
  onLogout,
  onToast,
}: {
  user: PublicUser;
  config: ServerConfig;
  onOpen: (map: MapSummary) => void;
  onLogout: () => void;
  onToast: (message: string) => void;
}) {
  const { t, relative } = useI18n();
  const [nav, setNav] = useState<NavKey>("mine");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<MapSummary[] | null>(null);
  const [counts, setCounts] = useState({ mine: 0, shared: 0 });
  /** Menu contestuale aperto su una scheda, e mappa in attesa di conferma. */
  const [menu, setMenu] = useState<{ map: MapSummary; anchor: HTMLElement } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MapSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.maps("all");
        if (cancelled) return;
        setItems(result.items);
        setCounts(result.counts);
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => {
    if (!items) return null;
    let list = items;
    if (nav === "mine") list = items.filter((item) => item.role === "owner");
    else if (nav === "shared") list = items.filter((item) => item.role !== "owner");
    else if (nav === "fav") list = items.slice(0, 2);
    else if (nav === "trash") list = [];

    const needle = query.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((item) =>
      `${item.name} ${item.description}`.toLowerCase().includes(needle),
    );
  }, [items, nav, query]);

  const countFor = (key: NavKey): number =>
    key === "mine"
      ? counts.mine
      : key === "shared"
        ? counts.shared
        : key === "recent"
          ? counts.mine + counts.shared
          : 0;

  const createMap = async () => {
    try {
      const result = await api.createMap(t("dash.newName"));
      setItems((current) => (current ? [result.map, ...current] : [result.map]));
      setCounts((current) => ({ ...current, mine: current.mine + 1 }));
      onToast(t("toast.created"));
      onOpen(result.map);
    } catch {
      onToast(t("err.generic"));
    }
  };

  /**
   * L'eliminazione è definitiva e a cascata: il vincolo ON DELETE CASCADE dello
   * schema porta via condivisioni, inviti e cronologia insieme alla mappa. Per
   * questo passa da una conferma esplicita che nomina la mappa, invece che da
   * un solo clic in un menu.
   */
  const removeMap = async (map: MapSummary) => {
    setConfirmDelete(null);
    try {
      await api.deleteMap(map.id);
      setItems((current) => (current ? current.filter((item) => item.id !== map.id) : current));
      setCounts((current) => ({ ...current, mine: Math.max(0, current.mine - 1) }));
      onToast(t("toast.deleted"));
    } catch {
      onToast(t("err.generic"));
    }
  };

  const subtitle =
    nav === "mine"
      ? t("dash.countMine", visible?.length ?? 0)
      : nav === "shared"
        ? t("dash.countShared", visible?.length ?? 0)
        : t(`dash.count${nav.charAt(0).toUpperCase()}${nav.slice(1)}` as "dash.countRecent");

  return (
    <div className="app">
      <header className="appbar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="globe" size={15} />
          </span>
          <span className="brand-name">Sestante</span>
          <span className="brand-sub mono">{config.orgLabel}</span>
        </div>
        <div className="searchbox">
          <Icon name="search" size={14} />
          <input
            className="input"
            type="search"
            placeholder={t("dash.search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="spacer" />
        <button type="button" className="btn btn-primary" onClick={() => void createMap()}>
          <Icon name="plus" size={14} />
          <span>{t("dash.new")}</span>
        </button>
        <LanguageButton />
        <ThemeButton />
        <UserButton user={user} onLogout={onLogout} />
      </header>

      <div className="dash-body">
        <nav className="dash-nav">
          {NAV.map((item) => (
            <button
              key={item.key}
              type="button"
              className="nav-item"
              aria-current={nav === item.key}
              onClick={() => setNav(item.key)}
            >
              <Icon name={item.icon} />
              <span>{t(`nav.${item.key}` as "nav.mine")}</span>
              {countFor(item.key) ? <span className="sp mono">{countFor(item.key)}</span> : null}
            </button>
          ))}
          <div className="quota">
            <span className="eyebrow">{t("dash.quota")}</span>
            <div className="meter">
              <i style={{ width: `${Math.min(100, (items?.length ?? 0) * 8)}%` }} />
            </div>
            <span className="hint mono">{items?.length ?? 0} / 50</span>
          </div>
        </nav>

        <main className="dash-main">
          <div className="dash-head">
            <div>
              <h1>{t(`nav.${nav}` as "nav.mine")}</h1>
              <p>{subtitle}</p>
            </div>
          </div>

          <div className="grid-maps">
            {visible === null ? (
              <p className="empty">{t("dash.loading")}</p>
            ) : visible.length === 0 ? (
              <p className="empty">{t("dash.empty")}</p>
            ) : (
              visible.map((map) => (
                <article
                  key={map.id}
                  className="mapcard"
                  onClick={() => onOpen(map)}
                  onKeyDown={(event) => event.key === "Enter" && onOpen(map)}
                  tabIndex={0}
                  role="button"
                >
                  <div className="thumb">
                    <Thumbnail shape={map.thumb} />
                    <span className="chip">
                      <Icon
                        name={
                          map.generalAccess === "private"
                            ? "lock"
                            : map.generalAccess === "link"
                              ? "link"
                              : "building"
                        }
                        size={11}
                      />
                      {t(`vis.${map.generalAccess}` as "vis.private")}
                    </span>
                    {map.liveSession ? (
                      <span className="chip live">
                        <span className="dot dot-ok" />
                        <Icon name="broadcast" size={11} />
                      </span>
                    ) : null}
                  </div>
                  <div className="mapcard-body">
                    <div className="mapcard-head">
                      <h3 className="mapcard-title">{map.name}</h3>
                      {map.role === "owner" ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm card-menu"
                          title={t("card.actions")}
                          aria-label={t("card.actions")}
                          onClick={(event) => {
                            // Senza questo, il clic aprirebbe anche la mappa.
                            event.stopPropagation();
                            setMenu({ map, anchor: event.currentTarget });
                          }}
                        >
                          <Icon name="dots" size={15} />
                        </button>
                      ) : null}
                    </div>
                    <p className="mapcard-desc">{map.description}</p>
                    <div className="mapcard-foot">
                      <span className={`badge badge-${map.role}`}>
                        {t(`role.${map.role}` as "role.owner")}
                      </span>
                      <span className="stack">
                        <Avatar name={map.owner.displayName} color={map.owner.color} />
                        {map.collaborators.slice(0, 3).map((person) => (
                          <Avatar key={person.id} name={person.displayName} color={person.color} />
                        ))}
                      </span>
                      <span className="when">{relative(map.updatedAt)}</span>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </main>
      </div>

      {menu ? (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)}>
          <MenuItem
            label={t("card.delete")}
            icon="trash"
            onSelect={() => {
              setConfirmDelete(menu.map);
              setMenu(null);
            }}
          />
        </Popover>
      ) : null}

      {confirmDelete ? (
        <div
          className="overlay"
          onMouseDown={(event) => event.target === event.currentTarget && setConfirmDelete(null)}
        >
          <div className="dialog" role="alertdialog" aria-modal="true" style={{ maxWidth: 400 }}>
            <div>
              <h2>{t("confirm.deleteTitle", confirmDelete.name)}</h2>
              <p className="sub">{t("confirm.deleteBody")}</p>
            </div>
            <div className="row">
              <div className="spacer" />
              <button type="button" className="btn btn-outline" onClick={() => setConfirmDelete(null)}>
                {t("common.cancel")}
              </button>
              <button type="button" className="btn btn-danger" onClick={() => void removeMap(confirmDelete)}>
                {t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
