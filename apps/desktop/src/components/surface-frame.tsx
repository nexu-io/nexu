import { useCallback } from "react";

function NexuLogo({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 85 85"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Nexu logo"
    >
      <path
        d="M20.5645 0C31.9219 0 41.1289 9.20702 41.1289 20.5645V36.7227C41.1288 39.1562 39.1562 41.1287 36.7227 41.1289H21.9355V21.9355H19.1934V41.1289H4.40625C1.97279 41.1287 0.000138274 39.1561 0 36.7227V20.5645C3.84333e-05 9.20704 9.20704 3.19551e-05 20.5645 0Z"
        fill="currentColor"
      />
      <path
        d="M64.4355 85C53.0781 85 43.8711 75.793 43.8711 64.4355L43.8711 48.2773C43.8712 45.8438 45.8438 43.8713 48.2773 43.8711L63.0645 43.8711L63.0645 63.0645L65.8066 63.0645L65.8066 43.8711L80.5938 43.8711C83.0272 43.8713 84.9999 45.8439 85 48.2773L85 64.4355C85 75.793 75.793 85 64.4355 85Z"
        fill="currentColor"
      />
      <path
        d="M43.8711 20.5659C43.8711 9.20847 53.0781 0.00149496 64.4355 0.00146394C75.3319 0.00146347 84.2471 8.47613 84.9531 19.1938L65.8066 19.1938L65.8066 21.9351L84.9531 21.9351C84.2484 32.6541 75.3329 41.1304 64.4355 41.1304C53.0781 41.1303 43.8711 31.9233 43.8711 20.5659Z"
        fill="currentColor"
      />
      <path
        d="M-8.98858e-07 64.4365C-1.12552e-06 59.2511 1.91919 54.5139 5.08594 50.8965L15.7773 61.5869L17.7168 59.6484L7.02539 48.958C10.6429 45.791 15.3797 43.8711 20.5654 43.8711C25.5341 43.8711 30.0909 45.6337 33.6455 48.5674L22.5625 59.6504L24.501 61.5889L35.6396 50.4512C39.0451 54.1206 41.1288 59.0337 41.1289 64.4346C41.1289 69.6203 39.2093 74.3581 36.042 77.9756L24.2031 66.1357L22.2637 68.0742L34.1025 79.9141C30.4854 83.0804 25.7492 84.9999 20.5645 85C15.1634 85 10.2486 82.9172 6.5791 79.5117L18.0146 68.0771L16.0762 66.1377L4.69629 77.5176C1.76236 73.9629 1.29779e-06 69.4055 -8.98858e-07 64.4365Z"
        fill="currentColor"
      />
    </svg>
  );
}

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
      if (!el || !src) return;
      if (preload) {
        el.setAttribute("preload", preload);
      }
      el.setAttribute("src", src);
    },
    [preload, src],
  );

  return (
    <section className="surface-frame">
      {src ? (
        <webview
          ref={webviewRefCallback as React.Ref<HTMLWebViewElement>}
          className="desktop-web-frame"
          key={`${src}:${version}`}
          // @ts-expect-error Electron webview boolean attribute — must be empty string, not boolean
          allowpopups=""
        />
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            gap: "16px",
            background: "var(--color-bg, #0a0a0a)",
          }}
        >
          <NexuLogo className="nexu-splash-logo" />
          <style>{`
            .nexu-splash-logo {
              width: 48px;
              height: 48px;
              color: rgba(255,255,255,0.25);
              animation: nexu-pulse 2s ease-in-out infinite;
            }
            @keyframes nexu-pulse {
              0%, 100% { opacity: 0.3; transform: scale(1); }
              50% { opacity: 0.8; transform: scale(1.05); }
            }
          `}</style>
        </div>
      )}
    </section>
  );
}
