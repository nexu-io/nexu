import { useState } from "react";

export function PreviewBanner() {
  const [dismissed, setDismissed] = useState(false);
  const isPreview = import.meta.env.VITE_PREVIEW === "true";
  const hash = import.meta.env.VITE_COMMIT_HASH;
  const shortCommitHash = hash ? hash.slice(0, 7) : "unknown";

  if (!isPreview || dismissed) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 top-0 z-[9999] flex items-center justify-between bg-gradient-to-r from-yellow-500 to-orange-500 px-4 py-2 text-sm font-medium text-white shadow-md">
      <span>
        Preview Environment <span className="font-mono">{shortCommitHash}</span>
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="rounded px-2 leading-none text-white/90 transition hover:bg-white/20 hover:text-white"
        aria-label="Close preview banner"
      >
        ×
      </button>
    </div>
  );
}
