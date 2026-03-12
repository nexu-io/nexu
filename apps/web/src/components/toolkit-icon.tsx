import { cn } from "@/lib/utils";
import { useState } from "react";

// ─── Deterministic color from name ─────────────────────────
// Gives each toolkit a consistent, warm-toned accent for the fallback.

const FALLBACK_PALETTES = [
  { bg: "bg-amber-50", text: "text-amber-700" },
  { bg: "bg-sky-50", text: "text-sky-700" },
  { bg: "bg-emerald-50", text: "text-emerald-700" },
  { bg: "bg-rose-50", text: "text-rose-700" },
  { bg: "bg-violet-50", text: "text-violet-700" },
  { bg: "bg-orange-50", text: "text-orange-700" },
  { bg: "bg-teal-50", text: "text-teal-700" },
  { bg: "bg-indigo-50", text: "text-indigo-700" },
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ─── Component ─────────────────────────────────────────────

type ToolkitIconSize = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<ToolkitIconSize, string> = {
  sm: "w-7 h-7 rounded-lg",
  md: "w-9 h-9 rounded-lg",
  lg: "w-10 h-10 rounded-xl",
};

const FONT_CLASSES: Record<ToolkitIconSize, string> = {
  sm: "text-[11px]",
  md: "text-[13px]",
  lg: "text-[15px]",
};

export function ToolkitIcon({
  iconUrl,
  fallbackIconUrl,
  name,
  size = "md",
  className,
}: {
  iconUrl: string;
  fallbackIconUrl?: string;
  name: string;
  size?: ToolkitIconSize;
  className?: string;
}) {
  const [primaryFailed, setPrimaryFailed] = useState(false);
  const [fallbackFailed, setFallbackFailed] = useState(false);

  const paletteIndex = hashString(name) % FALLBACK_PALETTES.length;
  const bg = FALLBACK_PALETTES[paletteIndex]?.bg ?? "bg-surface-3";
  const textColor = FALLBACK_PALETTES[paletteIndex]?.text ?? "text-text-muted";

  const imgClasses = cn(
    "object-contain shrink-0 p-1.5",
    SIZE_CLASSES[size],
    className,
  );

  // Stage 1: local pre-downloaded icon
  if (!primaryFailed && iconUrl) {
    return (
      <img
        src={iconUrl}
        alt={name}
        className={imgClasses}
        onError={() => setPrimaryFailed(true)}
      />
    );
  }

  // Stage 2: Google S2 favicon fallback
  if (!fallbackFailed && fallbackIconUrl) {
    return (
      <img
        src={fallbackIconUrl}
        alt={name}
        className={imgClasses}
        onError={() => setFallbackFailed(true)}
      />
    );
  }

  // Stage 3: colored initial letter
  return (
    <div
      className={cn(
        "flex items-center justify-center shrink-0 font-semibold",
        SIZE_CLASSES[size],
        bg,
        textColor,
        FONT_CLASSES[size],
        className,
      )}
    >
      {name[0]?.toUpperCase()}
    </div>
  );
}
