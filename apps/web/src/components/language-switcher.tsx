import { ChevronDown, Globe } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type Locale, useLocale } from "../hooks/use-locale";

interface Props {
  variant?: "light" | "dark" | "muted";
  size?: "xs" | "sm" | "md";
}

export function LanguageSwitcher({ variant = "light", size = "sm" }: Props) {
  const { locale, setLocale } = useLocale();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const base =
    size === "xs"
      ? "h-9 min-w-[132px] px-3 text-[12px]"
      : size === "sm"
        ? "h-11 min-w-[162px] px-3.5 text-[13px]"
        : "h-12 min-w-[176px] px-4 text-[14px]";
  const optionBase =
    size === "xs"
      ? "h-9 px-3.5 text-[12px]"
      : size === "sm"
        ? "h-10 px-4 text-[13px]"
        : "h-11 px-4 text-[14px]";

  const options: Array<{ value: Locale; label: string }> = [
    { value: "en", label: "English" },
    { value: "zh", label: "中文" },
  ];

  const currentLabel =
    options.find((option) => option.value === locale)?.label ?? "English";

  const colors = {
    light: {
      trigger:
        "border border-white/8 bg-[#222227]/92 text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-md hover:bg-[#27272d]",
      triggerOpen: "ring-2 ring-[#f0a526] ring-offset-0",
      menu: "border border-white/8 bg-[#1a1a1f]/96 shadow-[0_18px_38px_rgba(0,0,0,0.24)] backdrop-blur-xl",
      option: "text-white/62 hover:bg-white/[0.04] hover:text-white",
      optionActive: "bg-white text-[#121215]",
    },
    dark: {
      trigger:
        "border border-black/8 bg-white/92 text-[#18181b] shadow-[0_8px_24px_rgba(0,0,0,0.08)] backdrop-blur-md hover:bg-white",
      triggerOpen: "ring-1 ring-black/10 ring-offset-0",
      menu: "border border-black/8 bg-white/96 shadow-[0_18px_38px_rgba(0,0,0,0.10)] backdrop-blur-xl",
      option:
        "text-text-secondary hover:bg-black/[0.04] hover:text-text-primary",
      optionActive: "bg-[#18181b] text-white",
    },
    muted: {
      trigger:
        "border border-border bg-surface-1 text-text-primary shadow-[0_8px_24px_rgba(0,0,0,0.05)] hover:bg-surface-0",
      triggerOpen: "ring-1 ring-black/8 ring-offset-0",
      menu: "border border-border bg-surface-0 shadow-[0_14px_32px_rgba(0,0,0,0.08)]",
      option: "text-text-secondary hover:bg-surface-2 hover:text-text-primary",
      optionActive: "bg-surface-3 text-text-primary",
    },
  }[variant];

  return (
    <div
      ref={rootRef}
      className="relative z-50 inline-flex pointer-events-auto"
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex items-center gap-3 rounded-[24px] transition-all cursor-pointer font-semibold ${base} ${colors.trigger} ${
          open ? colors.triggerOpen : ""
        }`}
      >
        <Globe
          size={size === "xs" ? 16 : size === "sm" ? 18 : 19}
          className="shrink-0"
        />
        <span className="flex-1 text-left leading-none">{currentLabel}</span>
        <ChevronDown
          size={size === "xs" ? 14 : size === "sm" ? 16 : 17}
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute right-0 top-[calc(100%+12px)] z-50 min-w-full overflow-hidden rounded-[24px] p-2 pointer-events-auto ${colors.menu}`}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitem"
              onClick={() => {
                setLocale(option.value);
                setOpen(false);
              }}
              className={`flex w-full items-center rounded-[18px] transition-all cursor-pointer font-medium ${optionBase} ${
                locale === option.value ? colors.optionActive : colors.option
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
