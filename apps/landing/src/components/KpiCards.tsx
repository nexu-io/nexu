import { useEffect, useRef, useState } from "react";

const CARDS = [
  { src: "/media/frame-42.png", alt: "Portrait 1" },
  {
    src: "/media/pages/home/a2dbb92dd6-1772639650/kai1.jpg",
    srcSet:
      "/media/pages/home/a2dbb92dd6-1772639650/kai1-400x-q95.webp 400w, /media/pages/home/a2dbb92dd6-1772639650/kai1-800x-q95.webp 800w, /media/pages/home/a2dbb92dd6-1772639650/kai1-1200x-q95.webp 1200w",
    alt: "Kai 1",
  },
  {
    src: "/media/pages/home/2453852a49-1772639648/kai.jpg",
    srcSet:
      "/media/pages/home/2453852a49-1772639648/kai-400x-q95.webp 400w, /media/pages/home/2453852a49-1772639648/kai-800x-q95.webp 800w",
    alt: "Kai",
  },
  {
    src: "/media/pages/home/27a8c74d49-1772639644/kai3-02.jpg",
    srcSet:
      "/media/pages/home/27a8c74d49-1772639644/kai3-02-400x-q95.webp 400w, /media/pages/home/27a8c74d49-1772639644/kai3-02-800x-q95.webp 800w",
    alt: "Kai 3",
  },
  {
    src: "/media/pages/home/a2dbb92dd6-1772639650/kai1.jpg",
    alt: "Kai 1 repeat",
  },
  {
    src: "/media/pages/home/54ab68a934-1772639649/kai4.jpg",
    srcSet:
      "/media/pages/home/54ab68a934-1772639649/kai4-400x-q95.webp 400w, /media/pages/home/54ab68a934-1772639649/kai4-800x-q95.webp 800w",
    alt: "Kai 4",
  },
  {
    src: "/media/pages/home/2453852a49-1772639648/kai.jpg",
    alt: "Kai repeat",
  },
];

const TITLE_LEFT = "Proven Impact";
const TITLE_RIGHT = "at Enterprise Scale";

export default function KpiCards() {
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

  // Title split: first 15% of progress
  const titleP = Math.min(1, progress / 0.15);
  const titleSpread = titleP * 60; // px offset

  // Cards appear from 15% to 100%
  const cardProgress = Math.max(0, (progress - 0.15) / 0.85);
  const cardSegment = 1 / CARDS.length;

  return (
    <div
      ref={wrapperRef}
      style={{
        height: `${(CARDS.length + 2) * 100}vh`,
        position: "relative",
      }}
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
          perspective: "1200px",
          overflow: "hidden",
        }}
      >
        {/* Title */}
        <div
          style={{
            display: "flex",
            gap: "0.5em",
            fontSize: "clamp(1.5rem, 4vw, 3rem)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            marginBottom: "3rem",
            textAlign: "center",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              transform: `translateX(-${titleSpread}px)`,
              transition: "transform 0.05s linear",
            }}
          >
            {TITLE_LEFT}
          </span>
          <span
            style={{
              transform: `translateX(${titleSpread}px)`,
              transition: "transform 0.05s linear",
            }}
          >
            {TITLE_RIGHT}
          </span>
        </div>

        {/* Card stack */}
        <div
          style={{
            position: "relative",
            width: "160px",
            height: "160px",
          }}
        >
          {CARDS.map((card, i) => {
            const cardStart = i * cardSegment;
            // Is this card visible?
            const visible = cardProgress >= cardStart;
            // Local progress for this card
            const localP = visible
              ? Math.min(1, (cardProgress - cardStart) / cardSegment)
              : 0;

            // Scale: enters from 0 to 1
            const scale = visible ? Math.min(1, localP * 3) : 0;

            // Cards after this one push it into the stack
            const cardsAfter = Math.max(
              0,
              Math.floor((cardProgress - cardStart) / cardSegment) - 1,
            );
            const stackZ = -cardsAfter * 100;
            const stackY = -cardsAfter * 20;
            const stackOpacity = Math.max(0.3, 1 - cardsAfter * 0.15);

            return (
              <div
                key={card.alt}
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  overflow: "hidden",
                  transform: `scale(${scale}) translateZ(${stackZ}px) translateY(${stackY}px)`,
                  opacity: visible ? stackOpacity : 0,
                  transition: "transform 0.1s ease, opacity 0.1s ease",
                  border: "3px solid white",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
                }}
              >
                <img
                  src={card.src}
                  srcSet={"srcSet" in card ? card.srcSet : undefined}
                  alt={card.alt}
                  loading="lazy"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
