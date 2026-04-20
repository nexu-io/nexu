import type { ReactNode } from "react";

export function SurfaceButton({
  active,
  disabled,
  icon,
  label,
  meta,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  label: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "desktop-nav-item is-active" : "desktop-nav-item"}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {icon && <span className="desktop-nav-icon">{icon}</span>}
      <span>{label}</span>
      <small>{meta}</small>
    </button>
  );
}
