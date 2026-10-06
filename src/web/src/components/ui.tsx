/** Primitive condivise: avatar, popover, menu, toast, anteprime cartografiche. */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "../lib/icons";
import { THUMBS } from "../lib/thumbs";

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
}

export function Avatar({
  name,
  color,
  large,
  live,
  title,
}: {
  name: string;
  color: string;
  large?: boolean;
  live?: boolean;
  title?: string;
}) {
  return (
    <span
      className={`avatar${large ? " avatar-lg" : ""}${live ? " avatar-live" : ""}`}
      style={{ background: color }}
      title={title ?? name}
    >
      {initials(name)}
    </span>
  );
}

/**
 * Popover ancorato a un elemento. Si posiziona dopo il montaggio misurando il
 * contenuto, così un menu vicino al bordo si ribalta invece di uscire dalla
 * finestra; il portale lo tiene fuori da qualunque contenitore con overflow.
 */
export function Popover({
  anchor,
  onClose,
  align = "end",
  children,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  align?: "start" | "end";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const anchorBox = anchor.getBoundingClientRect();
    const box = ref.current.getBoundingClientRect();
    let left = align === "start" ? anchorBox.left : anchorBox.right - box.width;
    left = Math.max(8, Math.min(left, window.innerWidth - box.width - 8));
    let top = anchorBox.bottom + 5;
    if (top + box.height > window.innerHeight - 8) {
      top = Math.max(8, anchorBox.top - box.height - 5);
    }
    setPosition({ left, top });
  }, [anchor, align]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      className="pop"
      role="menu"
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({
  label,
  icon,
  hint,
  checked,
  onSelect,
}: {
  label: string;
  icon?: IconName;
  hint?: string;
  checked?: boolean;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      className="mi"
      role="menuitem"
      aria-checked={checked}
      onClick={onSelect}
    >
      <span className="tick">{checked ? <Icon name="check" size={13} /> : null}</span>
      {icon ? <Icon name={icon} size={14} /> : null}
      <span>{label}</span>
      {hint ? <span className="sp mono">{hint}</span> : null}
    </button>
  );
}

export const MenuHeading = ({ children }: { children: ReactNode }) => (
  <div className="mi-head">{children}</div>
);
export const MenuSeparator = () => <div className="mi-sep" />;

/** Anteprima cartografica di una mappa, disegnata dai contorni Natural Earth. */
export function Thumbnail({ shape }: { shape: string }) {
  const path = THUMBS[shape] ?? THUMBS.italia ?? "";
  return (
    <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="320" height="180" fill="hsl(var(--map-water))" />
      <path
        d={path}
        fill="hsl(var(--map-land))"
        stroke="hsl(var(--map-line))"
        strokeWidth={0.6}
      />
    </svg>
  );
}

export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 2600);
    return () => window.clearTimeout(timer);
  }, [message, onDone]);
  return (
    <div className="toast" role="status">
      {message}
    </div>
  );
}

/** Piccolo hook per gestire un pulsante che apre un popover. */
export function usePopover() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const toggle = useCallback((event: { currentTarget: HTMLElement }) => {
    const element = event.currentTarget;
    setAnchor((current) => (current === element ? null : element));
  }, []);
  const close = useCallback(() => setAnchor(null), []);
  return { anchor, toggle, close };
}
