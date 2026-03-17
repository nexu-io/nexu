import { useEffect, useRef, useState } from "react";

interface Badge {
  label: string;
  x: number; // % from left
  y: number; // % from top
}

const BADGES: Badge[] = [
  { label: "SAP", x: 50, y: 1.9 },
  { label: "Oracle", x: 66.5, y: 11.1 },
  { label: "Salesforce", x: 76.6, y: 35.1 },
  { label: "Microsoft Teams", x: 76.6, y: 64.9 },
  { label: "Workday", x: 66.5, y: 88.9 },
  { label: "ServiceNow", x: 50, y: 98.1 },
  { label: "Coupa", x: 33.5, y: 88.9 },
  { label: "Ariba", x: 23.4, y: 64.9 },
  { label: "Slack", x: 23.4, y: 35.1 },
  { label: "Dynamics 365", x: 33.5, y: 11.1 },
];

const CENTER_X = 50;
const CENTER_Y = 50;

export default function ToolsScrollTunnel() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    function onScroll() {
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const total = wrapper.offsetHeight - window.innerHeight;
      if (total <= 0) return;
      const p = Math.max(0, Math.min(1, -rect.top / total));
      setProgress(p);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      ref={wrapperRef}
      style={{ height: "250vh", position: "relative" }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          height: "100vh",
          overflow: "hidden",
          background: "#000",
          display: "flex",
          alignItems: "center",
        }}
      >
        {/* Center video with radial mask — matches source layout */}
        <div
          className="container"
          style={{ width: "100%" }}
        >
          <div
            style={{
              position: "relative",
              paddingTop: "8%",
              paddingBottom: "8%",
              WebkitMaskImage: "radial-gradient(ellipse at center, black 45%, transparent 78%)",
              maskImage: "radial-gradient(ellipse at center, black 45%, transparent 78%)",
            }}
          >
            <div style={{ width: "55%", margin: "0 auto" }}>
              <video
                className="rounded-3xl w-full"
                autoPlay
                muted
                loop
                playsInline
                style={{ display: "block" }}
              >
                <source src="/media/pages/home/video0-1.mp4" type="video/mp4" />
              </video>
            </div>
            {/* Badges — positioned inside the radial-masked wrapper */}
            {BADGES.map((badge) => {
              const currentX = badge.x + (CENTER_X - badge.x) * progress;
              const currentY = badge.y + (CENTER_Y - badge.y) * progress;
              const opacity = Math.max(0, 1 - progress * 2);

              return (
                <span
                  key={badge.label}
                  style={{
                    position: "absolute",
                    left: `${currentX}%`,
                    top: `${currentY}%`,
                    transform: "translate(-50%, -50%)",
                    opacity,
                    background: "rgba(255,255,255,0.08)",
                    backdropFilter: "blur(14px)",
                    WebkitBackdropFilter: "blur(14px)",
                    border: "1px solid rgba(255,255,255,0.18)",
                    borderRadius: "9999px",
                    padding: "9px 20px",
                    color: "rgba(255,255,255,0.9)",
                    fontSize: "13px",
                    whiteSpace: "nowrap",
                    pointerEvents: "none",
                    willChange: "transform, opacity",
                  }}
                >
                  {badge.label}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
