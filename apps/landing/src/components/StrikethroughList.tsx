import { useEffect, useRef, useState } from "react";

const ITEMS = [
  "Complex installation",
  "Complex environmental dependencies",
  "Data loss",
];

export default function StrikethroughList() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    function onScroll() {
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const wrapperHeight = wrapper.offsetHeight;
      const viewportHeight = window.innerHeight;
      // Progress: 0 when top of wrapper hits bottom of viewport,
      // 1 when bottom of wrapper hits top of viewport
      const total = wrapperHeight - viewportHeight;
      if (total <= 0) return;
      const scrolled = -rect.top;
      const p = Math.max(0, Math.min(1, scrolled / total));
      setProgress(p);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const itemCount = ITEMS.length;
  // Each item gets an equal segment of the scroll
  const segmentSize = 1 / (itemCount + 0.5);

  // At progress=1, apply blur to all
  const allDone = progress > itemCount * segmentSize;

  return (
    <div
      ref={wrapperRef}
      style={{ height: `${(itemCount + 1) * 100}vh`, position: "relative", background: "#000" }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "2rem",
          overflow: "hidden",
          filter: allDone ? "blur(4px)" : "none",
          transition: "filter 0.5s ease",
          background: "#000",
          color: "#fff",
        }}
      >
        {ITEMS.map((text, i) => {
          const itemStart = i * segmentSize;
          const itemEnd = (i + 1) * segmentSize;
          // Local progress for this item (0 to 1)
          const localP =
            progress <= itemStart
              ? 0
              : progress >= itemEnd
                ? 1
                : (progress - itemStart) / segmentSize;

          // Slide up: starts at translateY(100vh), ends at 0
          const translateY = Math.max(0, (1 - Math.min(localP * 2, 1)) * 100);
          // Strikethrough: scaleX 0 -> 1 (starts at 30% of local, finishes at 70%)
          const strikeP = Math.max(
            0,
            Math.min(1, (localP - 0.3) / 0.4),
          );
          // Fade: once strikethrough done, fade to 0.2
          const opacity =
            localP < 0.7 ? 1 : 1 - (localP - 0.7) / 0.3 * 0.8;

          return (
            <div
              key={text}
              style={{
                position: "relative",
                transform: `translateY(${translateY}vh)`,
                opacity: Math.max(0.2, opacity),
                transition: "opacity 0.1s ease",
                fontSize: "clamp(1.5rem, 4vw, 3rem)",
                fontWeight: 700,
                letterSpacing: "-0.02em",
                lineHeight: 1.3,
                textAlign: "center",
                padding: "0 1rem",
              }}
            >
              <span style={{ position: "relative", display: "inline-block" }}>
                {text}
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    top: "50%",
                    width: "100%",
                    height: "3px",
                    backgroundColor: "currentColor",
                    transform: `scaleX(${strikeP})`,
                    transformOrigin: "left",
                    transition: "transform 0.05s linear",
                  }}
                />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
