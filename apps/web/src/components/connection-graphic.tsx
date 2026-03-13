import { ToolkitIcon } from "@/components/toolkit-icon";

// ─── Connection Graphic ─────────────────────────────────────
// Provider icon <-> dotted connector <-> nexu logo
// Used on the OAuth callback page to show the connection being established.

export function ConnectionGraphic({
  providerIconUrl,
  providerFallbackIconUrl,
  providerName,
}: {
  providerIconUrl: string;
  providerFallbackIconUrl?: string;
  providerName: string;
}) {
  return (
    <div className="flex items-center justify-center gap-3 mb-4">
      {/* Provider icon */}
      <div className="w-12 h-12 rounded-xl bg-surface-3 flex items-center justify-center">
        <ToolkitIcon
          iconUrl={providerIconUrl}
          fallbackIconUrl={providerFallbackIconUrl}
          name={providerName}
          size="lg"
        />
      </div>

      {/* Dotted connector */}
      <div className="flex items-center gap-1 text-text-muted">
        <div className="w-1.5 h-1.5 rounded-full bg-border" />
        <div className="w-6 h-px bg-border" />
        <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
        <div className="w-6 h-px bg-border" />
        <div className="w-1.5 h-1.5 rounded-full bg-border" />
      </div>

      {/* Nexu logo */}
      <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center">
        <div className="flex justify-center items-center w-7 h-7 rounded bg-accent">
          <span className="text-[10px] font-bold text-accent-fg">N</span>
        </div>
      </div>
    </div>
  );
}
