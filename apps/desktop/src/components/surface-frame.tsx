import { useCallback, useRef, useState } from "react";

/**
 * Animated Nexu logo loader — 4 quadrants light up sequentially in brand colors,
 * then fade out and repeat. Pure CSS, no framer-motion dependency.
 *
 * Colors: N=#F8672F (orange), E=#346E58 (green), X=#F3B0FF (pink), U=#EDC337 (gold)
 */
function NexuLoader({ size = 48 }: { size?: number }) {
  return (
    <>
      <svg
        width={size}
        height={size}
        viewBox="0 0 512 512"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Loading"
      >
        {/* Gray background shapes */}
        <path
          d="M161.308 72.5333C210.336 72.5335 250.081 112.279 250.081 161.308V231.059C250.081 241.565 241.565 250.082 231.059 250.082H91.5569C81.0508 250.082 72.5335 241.565 72.5334 231.059V161.308C72.5334 112.279 112.279 72.5333 161.308 72.5333ZM155.39 167.225V250.081H167.226V167.225H155.39Z"
          fill="#D4D4D4"
          opacity="0.15"
        />
        <path
          d="M261.919 161.313C261.919 112.284 301.665 72.5391 350.693 72.5391C397.73 72.5393 436.221 109.122 439.27 155.388L356.61 155.388L356.61 167.225L439.271 167.225C436.229 213.497 397.735 250.087 350.693 250.087C301.665 250.087 261.919 210.341 261.919 161.313Z"
          fill="#D4D4D4"
          opacity="0.15"
        />
        <path
          d="M72.5334 350.697C72.5334 328.311 80.8194 307.862 94.4905 292.245L140.643 338.396L149.012 330.027L102.861 283.876C118.477 270.205 138.926 261.918 161.312 261.918C182.76 261.918 202.432 269.526 217.777 282.19L169.931 330.035L178.301 338.405L226.389 290.317C241.091 306.158 250.081 327.374 250.081 350.69C250.081 373.075 241.794 393.525 228.122 409.141L177.014 358.031L168.644 366.4L219.753 417.51C204.137 431.18 183.689 439.466 161.305 439.466C137.99 439.466 116.774 430.478 100.934 415.778L150.3 366.411L141.931 358.042L92.8069 407.166C80.1413 391.821 72.5335 372.147 72.5334 350.697Z"
          fill="#D4D4D4"
          opacity="0.15"
        />
        <path
          d="M350.691 439.466C301.663 439.466 261.918 399.72 261.918 350.692L261.918 280.941C261.918 270.435 270.434 261.917 280.94 261.917L420.442 261.917C430.948 261.917 439.466 270.435 439.466 280.941L439.466 350.692C439.466 399.72 399.72 439.466 350.691 439.466ZM356.61 344.774L356.61 261.918L344.774 261.918L344.774 344.774L356.61 344.774Z"
          fill="#D4D4D4"
          opacity="0.15"
        />
        {/* Colored overlay shapes with staggered animation */}
        <path
          className="nexu-q nexu-q1"
          d="M161.308 72.5333C210.336 72.5335 250.081 112.279 250.081 161.308V231.059C250.081 241.565 241.565 250.082 231.059 250.082H91.5569C81.0508 250.082 72.5335 241.565 72.5334 231.059V161.308C72.5334 112.279 112.279 72.5333 161.308 72.5333ZM155.39 167.225V250.081H167.226V167.225H155.39Z"
          fill="#F8672F"
        />
        <path
          className="nexu-q nexu-q2"
          d="M261.919 161.313C261.919 112.284 301.665 72.5391 350.693 72.5391C397.73 72.5393 436.221 109.122 439.27 155.388L356.61 155.388L356.61 167.225L439.271 167.225C436.229 213.497 397.735 250.087 350.693 250.087C301.665 250.087 261.919 210.341 261.919 161.313Z"
          fill="#346E58"
        />
        <path
          className="nexu-q nexu-q3"
          d="M72.5334 350.697C72.5334 328.311 80.8194 307.862 94.4905 292.245L140.643 338.396L149.012 330.027L102.861 283.876C118.477 270.205 138.926 261.918 161.312 261.918C182.76 261.918 202.432 269.526 217.777 282.19L169.931 330.035L178.301 338.405L226.389 290.317C241.091 306.158 250.081 327.374 250.081 350.69C250.081 373.075 241.794 393.525 228.122 409.141L177.014 358.031L168.644 366.4L219.753 417.51C204.137 431.18 183.689 439.466 161.305 439.466C137.99 439.466 116.774 430.478 100.934 415.778L150.3 366.411L141.931 358.042L92.8069 407.166C80.1413 391.821 72.5335 372.147 72.5334 350.697Z"
          fill="#F3B0FF"
        />
        <path
          className="nexu-q nexu-q4"
          d="M350.691 439.466C301.663 439.466 261.918 399.72 261.918 350.692L261.918 280.941C261.918 270.435 270.434 261.917 280.94 261.917L420.442 261.917C430.948 261.917 439.466 270.435 439.466 280.941L439.466 350.692C439.466 399.72 399.72 439.466 350.691 439.466ZM356.61 344.774L356.61 261.918L344.774 261.918L344.774 344.774L356.61 344.774Z"
          fill="#EDC337"
        />
      </svg>
      <style>{`
        .nexu-q {
          opacity: 0;
          transform-origin: center;
          animation: nexu-pop 2.8s ease-in-out infinite;
        }
        .nexu-q1 { animation-delay: 0s; }
        .nexu-q2 { animation-delay: 0.25s; }
        .nexu-q3 { animation-delay: 0.5s; }
        .nexu-q4 { animation-delay: 0.75s; }
        @keyframes nexu-pop {
          0%        { opacity: 0; transform: scale(0.85); }
          15%, 50%  { opacity: 1; transform: scale(1); }
          70%, 100% { opacity: 0; transform: scale(0.85); }
        }
      `}</style>
    </>
  );
}

export function SurfaceFrame({
  title: _title,
  description: _description,
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
  void _title;
  void _description;
  const [webviewReady, setWebviewReady] = useState(false);
  const prevSrcRef = useRef<string | null>(null);

  // Reset when src changes
  if (src !== prevSrcRef.current) {
    prevSrcRef.current = src;
    if (webviewReady) setWebviewReady(false);
  }

  const webviewRefCallback = useCallback(
    (el: HTMLElement | null) => {
      if (!el || !src) return;
      if (preload) {
        el.setAttribute("preload", preload);
      }
      // Listen for did-finish-load right on the element before setting src.
      // This avoids the race where dom-ready fires before useEffect can bind.
      el.addEventListener("did-finish-load", () => setWebviewReady(true), {
        once: true,
      });
      el.setAttribute("src", src);
    },
    [preload, src],
  );

  const showLoader = !src || !webviewReady;

  return (
    <section className="surface-frame" style={{ position: "relative" }}>
      {/* Webview always rendered (hidden behind loader until ready) */}
      {src && (
        <webview
          ref={webviewRefCallback as React.Ref<HTMLWebViewElement>}
          className="desktop-web-frame"
          key={`${src}:${version}`}
          // @ts-expect-error Electron webview boolean attribute — must be empty string, not boolean
          allowpopups=""
          style={{ opacity: webviewReady ? 1 : 0 }}
        />
      )}

      {/* Loader overlay — covers webview until content is ready */}
      {showLoader && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#ffffff",
            zIndex: 10,
            transition: "opacity 0.3s ease-out",
          }}
        >
          <NexuLoader size={96} />
        </div>
      )}
    </section>
  );
}
