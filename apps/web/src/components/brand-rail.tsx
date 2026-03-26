import { track } from "@/lib/tracking";
import {
  ArrowRight,
  Infinity as InfinityIcon,
  Shield,
  Sparkles,
} from "lucide-react";
import type { ReactNode } from "react";
import { useGitHubStars } from "../hooks/use-github-stars";
import { useLocale } from "../hooks/use-locale";

const GITHUB_URL = "https://github.com/nexu-io/nexu";

function GitHubIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      role="img"
      aria-label="GitHub"
    >
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function NexuIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 800 800"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="nexu"
    >
      <path
        d="M193.435 0C300.266 0 386.869 86.6036 386.869 193.435V345.42C386.869 368.312 368.311 386.87 345.419 386.87H41.4502C18.5579 386.87 0 368.311 0 345.419V193.435C0 86.6036 86.6036 0 193.435 0ZM180.539 206.328V386.867H206.331V206.328H180.539Z"
        fill="currentColor"
      />
      <path
        d="M606.095 799.53C499.264 799.53 412.661 712.926 412.661 606.095L412.661 454.11C412.661 431.217 431.219 412.659 454.111 412.659L758.08 412.659C780.972 412.659 799.53 431.218 799.53 454.111L799.53 606.095C799.53 712.926 712.926 799.53 606.095 799.53ZM618.991 593.2L618.991 412.661L593.2 412.661L593.2 593.2L618.991 593.2Z"
        fill="currentColor"
      />
      <path
        d="M799.531 193.447C799.531 193.551 799.53 193.655 799.53 193.759L799.53 193.134C799.53 193.238 799.531 193.343 799.531 193.447ZM412.662 193.447C412.662 86.6158 499.265 0.0122032 606.096 0.0121986C708.589 0.0121941 792.462 79.725 799.105 180.537L618.991 180.537L618.991 206.329L799.107 206.329C792.478 307.154 708.598 386.881 606.096 386.881C499.265 386.881 412.662 300.278 412.662 193.447Z"
        fill="currentColor"
      />
      <path
        d="M-8.45487e-06 606.105C-1.0587e-05 557.327 18.0554 512.768 47.8447 478.741L148.407 579.303L166.645 561.066L66.082 460.504C100.109 430.715 144.667 412.66 193.444 412.66C240.179 412.66 283.043 429.237 316.478 456.83L212.225 561.084L230.462 579.322L335.244 474.538C367.28 509.055 386.869 555.285 386.869 606.09C386.869 654.866 368.812 699.424 339.022 733.45L227.657 622.084L209.42 640.322L320.784 751.688C286.758 781.475 242.203 799.53 193.43 799.53C142.628 799.53 96.4006 779.944 61.8848 747.913L169.45 640.348L151.213 622.111L44.1758 729.148C16.5783 695.712 1.56674e-05 652.844 -8.45487e-06 606.105Z"
        fill="currentColor"
      />
    </svg>
  );
}

function NexuLogoWhite({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 85 85"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="nexu logo"
    >
      <path
        d="M20.5645 0C31.9219 0 41.1289 9.20702 41.1289 20.5645V36.7227C41.1288 39.1562 39.1562 41.1287 36.7227 41.1289H21.9355V21.9355H19.1934V41.1289H4.40625C1.97279 41.1287 0.000138274 39.1561 0 36.7227V20.5645C3.84333e-05 9.20704 9.20704 3.19551e-05 20.5645 0Z"
        fill="currentColor"
      />
      <path
        d="M64.4355 85C53.0781 85 43.8711 75.793 43.8711 64.4355L43.8711 48.2773C43.8712 45.8438 45.8438 43.8713 48.2773 43.8711L63.0645 43.8711L63.0645 63.0645L65.8066 63.0645L65.8066 43.8711L80.5938 43.8711C83.0272 43.8713 84.9999 45.8439 85 48.2773L85 64.4355C85 75.793 75.793 85 64.4355 85Z"
        fill="currentColor"
      />
      <path
        d="M43.8711 20.5659C43.8711 9.20847 53.0781 0.00149496 64.4355 0.00146394C75.3319 0.00146347 84.2471 8.47613 84.9531 19.1938L65.8066 19.1938L65.8066 21.9351L84.9531 21.9351C84.2484 32.6541 75.3329 41.1304 64.4355 41.1304C53.0781 41.1303 43.8711 31.9233 43.8711 20.5659Z"
        fill="currentColor"
      />
      <path
        d="M-8.98858e-07 64.4365C-1.12552e-06 59.2511 1.91919 54.5139 5.08594 50.8965L15.7773 61.5869L17.7168 59.6484L7.02539 48.958C10.6429 45.791 15.3797 43.8711 20.5654 43.8711C25.5341 43.8711 30.0909 45.6337 33.6455 48.5674L22.5625 59.6504L24.501 61.5889L35.6396 50.4512C39.0451 54.1206 41.1288 59.0337 41.1289 64.4346C41.1289 69.6203 39.2093 74.3581 36.042 77.9756L24.2031 66.1357L22.2637 68.0742L34.1025 79.9141C30.4854 83.0804 25.7492 84.9999 20.5645 85C15.1634 85 10.2486 82.9172 6.5791 79.5117L18.0146 68.0771L16.0762 66.1377L4.69629 77.5176C1.76236 73.9629 1.29779e-06 69.4055 -8.98858e-07 64.4365Z"
        fill="currentColor"
      />
    </svg>
  );
}

function FadeIn({
  children,
  delay = 0,
  className = "",
}: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <div
      className={`animate-fade-in-up ${className}`}
      style={{ animationDelay: `${delay}ms`, animationFillMode: "both" }}
    >
      {children}
    </div>
  );
}

export function BrandRail({
  topRight,
  onLogoClick,
}: {
  topRight?: ReactNode;
  onLogoClick: () => void;
}) {
  const { stars } = useGitHubStars();
  const { t } = useLocale();
  const bullets = [
    { icon: Sparkles, text: t("brand.bullet.openclaw") },
    { icon: Shield, text: t("brand.bullet.feishu") },
    { icon: InfinityIcon, text: t("brand.bullet.models") },
  ];

  return (
    <div className="hidden lg:flex lg:w-[46%] lg:min-h-screen relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_18%_18%,rgba(255,255,255,0.08),transparent_36%),radial-gradient(80%_80%_at_82%_22%,rgba(180,150,255,0.14),transparent_36%),linear-gradient(180deg,#0d0d10_0%,#0a0a0d_100%)]" />
      <div className="absolute -right-20 bottom-0 opacity-[0.05]">
        <NexuIcon className="h-[360px] w-[360px] text-white" />
      </div>

      <div className="relative z-10 flex w-full flex-col justify-between px-10 pb-12 pt-8 xl:px-12 xl:py-12">
        <FadeIn delay={80} className="flex items-center justify-between">
          <button
            type="button"
            onClick={onLogoClick}
            className="flex items-center cursor-pointer"
          >
            <NexuLogoWhite className="h-8 w-auto text-white xl:h-9" />
          </button>
          {topRight ?? <div />}
        </FadeIn>

        <div>
          <FadeIn delay={220}>
            <h1
              className="max-w-[560px] text-[40px] leading-[0.96] tracking-tight text-white sm:text-[52px] lg:text-[64px]"
              style={{ fontFamily: "Georgia, Times New Roman, serif" }}
            >
              {t("brand.title.line1")}
              <br />
              {t("brand.title.line2")}
            </h1>
          </FadeIn>

          <FadeIn delay={300}>
            <p className="mt-6 max-w-[460px] text-[15px] leading-[1.8] text-white/58">
              {t("brand.body")}
            </p>
          </FadeIn>

          <div className="mt-8 space-y-3">
            {bullets.map((item, index) => (
              <FadeIn key={item.text} delay={380 + index * 80}>
                <div className="grid min-h-[72px] grid-cols-[40px_1fr] items-center gap-4 rounded-2xl border border-white/8 bg-white/[0.025] px-5 py-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.06]">
                    <item.icon size={15} className="text-white/66" />
                  </div>
                  <p className="text-[13px] leading-[1.6] text-white/58">
                    {item.text}
                  </p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>

        <FadeIn delay={520}>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track("auth_github_click")}
            className="group inline-flex items-center gap-3 rounded-[24px] border border-white/8 bg-[#1f1f23]/92 px-5 py-4 text-[14px] font-medium text-white/82 shadow-[0_10px_28px_rgba(0,0,0,0.18)] transition-all hover:border-white/12 hover:bg-[#242429] hover:text-white"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-[18px] border border-white/6 bg-white/[0.05] text-white">
              <GitHubIcon size={18} />
            </div>
            <span>{t("brand.github")}</span>
            {stars && stars > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-white/82">
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="text-amber-400"
                  role="img"
                  aria-label="Star"
                >
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                {stars.toLocaleString()}
              </span>
            )}
            <ArrowRight
              size={15}
              className="opacity-65 transition-transform group-hover:translate-x-0.5"
            />
          </a>
        </FadeIn>
      </div>
    </div>
  );
}
