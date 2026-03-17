import { useEffect, useRef, useState } from "react";

interface Tab {
  title: string;
  subtitle: string;
  description: string;
  image: string;
}

const TABS: Tab[] = [
  {
    title: "Agent-Augmented Buying",
    subtitle: "Agent-Augmented Buying",
    description:
      "Lio turns complex buying into an effortless, guided experience...",
    image:
      "/media/pages/home/5de3630f55-1772655982/frame-1216292632.png",
  },
  {
    title: "Procurement automated",
    subtitle: "Procurement automated",
    description: "85% reduction in operational workload",
    image:
      "/media/pages/home/5de3630f55-1772655982/frame-1216292632.png",
  },
  {
    title: "Tame the Tailspend",
    subtitle: "Tame the Tailspend",
    description: "Scale Savings Without Scaling Headcount",
    image:
      "/media/pages/home/5de3630f55-1772655982/frame-1216292632.png",
  },
  {
    title: "Supercharge your Buyers",
    subtitle: "Supercharge your Buyers",
    description: "Gain 10x efficiency with Lio Agents",
    image:
      "/media/pages/home/5de3630f55-1772655982/frame-1216292632.png",
  },
  {
    title: "The Agentic Workforce",
    subtitle: "The Agentic Workforce",
    description:
      "Manage and scale your personal Agentic Workforce",
    image:
      "/media/pages/home/5de3630f55-1772655982/frame-1216292632.png",
  },
];

export default function FeaturesScrollTunnel() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [isScrollDriven, setIsScrollDriven] = useState(true);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    function onScroll() {
      if (!isScrollDriven) return;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const total = wrapper.offsetHeight - window.innerHeight;
      if (total <= 0) return;
      const p = Math.max(0, Math.min(1, -rect.top / total));
      const tabIndex = Math.min(
        TABS.length - 1,
        Math.floor(p * TABS.length),
      );
      setActiveTab(tabIndex);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [isScrollDriven]);

  function handleTabClick(index: number) {
    setIsScrollDriven(false);
    setActiveTab(index);
    // Re-enable scroll-driven after a short delay
    setTimeout(() => setIsScrollDriven(true), 2000);
  }

  return (
    <div
      ref={wrapperRef}
      style={{ height: "600vh", position: "relative" }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          background: "#fff",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: "3rem",
            maxWidth: "1200px",
            width: "100%",
            alignItems: "flex-start",
          }}
        >
          {/* Left: tabs */}
          <div style={{ flex: "0 0 40%", display: "flex", flexDirection: "column", gap: "1rem" }}>
            {TABS.map((tab, i) => (
              <button
                key={tab.title}
                type="button"
                onClick={() => handleTabClick(i)}
                style={{
                  textAlign: "left",
                  padding: "1.25rem",
                  borderRadius: "12px",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  opacity: i === activeTab ? 1 : 0.3,
                  transition: "opacity 0.3s ease, background 0.3s ease",
                }}
              >
                <div
                  style={{
                    fontSize: "1.125rem",
                    fontWeight: 600,
                    marginBottom: "0.5rem",
                  }}
                >
                  {tab.title}
                </div>
                {i === activeTab && (
                  <div
                    style={{
                      fontSize: "0.9rem",
                      opacity: 0.7,
                      lineHeight: 1.5,
                    }}
                  >
                    {tab.description}
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Right: image */}
          <div
            style={{
              flex: "1 1 60%",
              borderRadius: "16px",
              overflow: "hidden",
              position: "relative",
              aspectRatio: "16/10",
            }}
          >
            {TABS.map((tab, i) => (
              <img
                key={tab.title}
                src={tab.image}
                alt={tab.title}
                loading="lazy"
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  opacity: i === activeTab ? 1 : 0,
                  transition: "opacity 0.4s ease",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
