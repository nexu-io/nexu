import {
  Children,
  type ReactNode,
  isValidElement,
  useEffect,
  useRef,
  useState,
} from "react";

interface TextRevealProps {
  children: ReactNode;
  threshold?: number;
}

/** Recursively extract plain text from React children */
function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (!node) return "";
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) {
    return extractText(node.props.children);
  }
  return "";
}

/** Recursively extract paragraphs (strings) from React children */
function extractParagraphs(node: ReactNode): string[] {
  const paragraphs: string[] = [];

  function walk(n: ReactNode) {
    if (!n) return;
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (isValidElement(n)) {
      const tag = typeof n.type === "string" ? n.type : "";
      if (tag === "p") {
        paragraphs.push(extractText(n.props.children).trim());
      } else {
        // Recurse into wrapper divs etc.
        walk(n.props.children);
      }
      return;
    }
    if (typeof n === "string" && n.trim()) {
      paragraphs.push(n.trim());
    }
  }

  walk(node);
  return paragraphs.length > 0 ? paragraphs : [extractText(node).trim()];
}

export default function TextReveal({
  children,
  threshold = 50,
}: TextRevealProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  const paragraphs = extractParagraphs(children);
  const allWords = paragraphs.flatMap((p) => p.split(/\s+/).filter(Boolean));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function onScroll() {
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const triggerPoint = viewportHeight * (threshold / 100);

      const start = rect.top - triggerPoint;
      const end = rect.bottom - triggerPoint;
      const total = end - start;

      if (total <= 0) return;
      const p = Math.max(0, Math.min(1, -start / total));
      setProgress(p);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);

  const revealedCount = Math.floor(progress * allWords.length);
  let wordIndex = 0;

  // Paragraph-level: fade in + translateY
  const paraProgress = (i: number) => {
    const step = 1 / paragraphs.length;
    const start = i * step;
    return Math.max(0, Math.min(1, (progress - start) / step));
  };

  return (
    <div ref={containerRef}>
      <div className="space-y-8 t-24 lg:t-32">
        {paragraphs.map((para, pi) => {
          const words = para.split(/\s+/).filter(Boolean);
          const pp = paraProgress(pi);
          const paraY = Math.max(0, (1 - Math.min(pp * 3, 1)) * 50);
          const paraOpacity = Math.min(1, pp * 3);

          return (
            <p
              key={pi}
              style={{
                transform: `translateY(${paraY}px)`,
                opacity: paraOpacity,
                transition: "transform 0.1s ease, opacity 0.1s ease",
              }}
            >
              {words.map((word, wi) => {
                const globalIdx = wordIndex++;
                return (
                  <span
                    key={`${word}-${wi}`}
                    style={{
                      opacity: globalIdx < revealedCount ? 1 : 0.1,
                      transition: "opacity 0.15s ease",
                      display: "inline-block",
                      marginRight: "0.3em",
                    }}
                  >
                    {word}
                  </span>
                );
              })}
            </p>
          );
        })}
      </div>
    </div>
  );
}
