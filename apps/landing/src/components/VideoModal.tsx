import { useCallback, useEffect, useState } from "react";

export default function VideoModal() {
  const [open, setOpen] = useState(false);

  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);

  useEffect(() => {
    window.addEventListener("open-modal", handleOpen);
    return () => window.removeEventListener("open-modal", handleOpen);
  }, [handleOpen]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        handleClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, handleClose]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        backgroundColor: "rgba(0, 0, 0, 0.8)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        style={{
          position: "relative",
          width: "90vw",
          maxWidth: "960px",
          display: "flex",
          gap: "1.5rem",
        }}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={handleClose}
          style={{
            position: "absolute",
            top: "-2.5rem",
            right: 0,
            background: "none",
            border: "none",
            color: "white",
            fontSize: "1.5rem",
            cursor: "pointer",
            padding: "0.5rem",
            lineHeight: 1,
          }}
          aria-label="Close modal"
        >
          x
        </button>

        {/* Video */}
        <div
          style={{
            flex: "1 1 auto",
            aspectRatio: "16/9",
            borderRadius: "12px",
            overflow: "hidden",
            background: "black",
          }}
        >
          <iframe
            src="https://player.vimeo.com/video/1170630656?autoplay=1"
            style={{
              width: "100%",
              height: "100%",
              border: "none",
            }}
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            title="Demo video"
          />
        </div>

        {/* Sidebar playlist */}
        <div
          style={{
            flex: "0 0 200px",
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
          }}
        >
          <div
            style={{
              padding: "1rem",
              borderRadius: "8px",
              background: "rgba(255, 255, 255, 0.1)",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              cursor: "pointer",
            }}
          >
            <div
              style={{
                fontSize: "0.85rem",
                fontWeight: 600,
                color: "white",
                marginBottom: "0.25rem",
              }}
            >
              Product Demo
            </div>
            <div
              style={{
                fontSize: "0.75rem",
                color: "rgba(255, 255, 255, 0.6)",
              }}
            >
              Overview of nexu platform
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
