import { useEffect, useState } from "react";

const REPO = "refly-ai/nexu";
const CACHE_KEY = "nexu_github_stars";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  stars: number;
  ts: number;
}

export function useGitHubStars() {
  const [stars, setStars] = useState<number | null>(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const entry: CacheEntry = JSON.parse(cached);
        if (Date.now() - entry.ts < CACHE_TTL) return entry.stars;
      }
    } catch {
      /* ignore */
    }
    return null;
  });

  useEffect(() => {
    // If we have a fresh cache hit, skip fetch
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const entry: CacheEntry = JSON.parse(cached);
        if (Date.now() - entry.ts < CACHE_TTL) {
          setStars(entry.stars);
          return;
        }
      }
    } catch {
      /* ignore */
    }

    let cancelled = false;
    fetch(`https://api.github.com/repos/${REPO}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && typeof data.stargazers_count === "number") {
          const count = data.stargazers_count;
          setStars(count);
          try {
            localStorage.setItem(
              CACHE_KEY,
              JSON.stringify({ stars: count, ts: Date.now() }),
            );
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {
        /* silently fail, show fallback */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { stars, repo: REPO };
}
