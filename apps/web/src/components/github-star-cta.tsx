import { cn } from "@/lib/utils";
import { ArrowUpRight, Star } from "lucide-react";

const GITHUB_URL = "https://github.com/nexu-io/nexu";

type GitHubStarCtaProps = {
  label: string;
  stars?: number | null;
  className?: string;
  variant?: "button" | "inline" | "banner";
  description?: string;
  badgeLabel?: string;
  onClick?: () => void;
};

export function GitHubStarCta({
  label,
  stars,
  className,
  variant = "button",
  description,
  badgeLabel = "GitHub",
  onClick,
}: GitHubStarCtaProps) {
  if (variant === "banner") {
    return (
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        className={cn(
          "group block cursor-pointer rounded-2xl border border-border bg-white p-5 shadow-[var(--shadow-rest)] transition-all hover:scale-[1.01] hover:border-border-hover hover:shadow-[var(--shadow-refine)]",
          className,
        )}
      >
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-amber-200/60 bg-amber-50">
            <Star
              size={20}
              className="text-amber-500 transition-colors group-hover:fill-amber-500"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-text-primary">
              {label}
            </div>
            {description ? (
              <div className="mt-0.5 text-[12px] text-text-secondary">
                {description}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {stars && stars > 0 ? (
              <div className="flex items-center gap-1.5 rounded-lg border border-amber-200/50 bg-amber-50/80 px-3 py-1.5 text-[12px] font-medium text-[#92400e]">
                <Star size={12} className="fill-amber-500 text-amber-500" />
                <span className="tabular-nums">{stars.toLocaleString()}</span>
              </div>
            ) : null}
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200/60 bg-[rgba(251,191,36,0.12)] px-3 py-1.5 text-[12px] font-medium text-[#b45309] transition-colors group-hover:border-amber-300/60 group-hover:bg-[rgba(251,191,36,0.2)]">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
              </svg>
              <span>{badgeLabel}</span>
              <ArrowUpRight size={11} className="shrink-0 translate-y-px" />
            </div>
          </div>
        </div>
      </a>
    );
  }

  if (variant === "inline") {
    return (
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        className={cn("link-github-star group", className)}
      >
        <Star
          size={12}
          className="shrink-0 text-amber-500 transition-colors group-hover:fill-amber-500"
        />
        <span>{label}</span>
        {stars && stars > 0 ? (
          <span className="tabular-nums text-[10px] text-text-muted">
            ({stars.toLocaleString()})
          </span>
        ) : null}
        <ArrowUpRight size={11} className="shrink-0 translate-y-px" />
      </a>
    );
  }

  return (
    <a
      href={GITHUB_URL}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className={cn("link-github-star group", className)}
    >
      <Star
        size={13}
        className="shrink-0 text-amber-500 transition-colors group-hover:fill-amber-500"
      />
      <span>{label}</span>
      {stars && stars > 0 ? (
        <span className="tabular-nums text-[10px] text-text-muted">
          ({stars.toLocaleString()})
        </span>
      ) : null}
      <ArrowUpRight size={11} className="shrink-0 translate-y-px" />
    </a>
  );
}
