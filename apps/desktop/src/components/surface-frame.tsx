import { useCallback } from "react";

export function SurfaceFrame({
  title,
  description,
  src,
  version,
  preload,
}: {
  title: string;
  description: string;
  src: string | null;
  version: number;
  preload?: string;
}) {
  const webviewRefCallback = useCallback(
    (el: HTMLElement | null) => {
      if (!el || !preload) return;
      el.setAttribute("preload", preload);
    },
    [preload],
  );

  return (
    <section className="surface-frame">
      <header className="surface-frame-header">
        <div>
          <span className="surface-frame-eyebrow">embedded surface</span>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <code>{src ?? "Resolving local runtime URL..."}</code>
      </header>

      {src ? (
        <webview
          ref={webviewRefCallback as React.Ref<HTMLWebViewElement>}
          className="desktop-web-frame"
          key={`${src}:${version}`}
          src={src}
          // @ts-expect-error Electron webview boolean attribute — must be empty string, not boolean
          allowpopups=""
        />
      ) : (
        <div className="surface-frame-empty">
          <div className="surface-frame-spinner" />
          Starting local services…
        </div>
      )}
    </section>
  );
}
