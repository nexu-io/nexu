import Anthropic from "@lobehub/icons/es/Anthropic";
import Gemini from "@lobehub/icons/es/Gemini";
import Kimi from "@lobehub/icons/es/Kimi";
import Minimax from "@lobehub/icons/es/Minimax";
import OpenAI from "@lobehub/icons/es/OpenAI";
import OpenRouter from "@lobehub/icons/es/OpenRouter";
import PPIO from "@lobehub/icons/es/PPIO";
import SiliconCloud from "@lobehub/icons/es/SiliconCloud";
import ZAI from "@lobehub/icons/es/ZAI";
import Zhipu from "@lobehub/icons/es/Zhipu";
import type { CSSProperties, ComponentType } from "react";

type LobeIconProps = {
  size?: number | string;
  style?: CSSProperties;
  className?: string;
};

type LobeIconModule = {
  default?: unknown;
  Avatar?: unknown;
  Color?: unknown;
};

const LOBE_PROVIDER_ICONS: Record<string, LobeIconModule> = {
  anthropic: Anthropic as unknown as LobeIconModule,
  glm: Zhipu as unknown as LobeIconModule,
  google: Gemini as unknown as LobeIconModule,
  kimi: Kimi as unknown as LobeIconModule,
  minimax: Minimax as unknown as LobeIconModule,
  moonshot: Kimi as unknown as LobeIconModule,
  openai: OpenAI as unknown as LobeIconModule,
  openrouter: OpenRouter as unknown as LobeIconModule,
  ppio: PPIO as unknown as LobeIconModule,
  siliconflow: SiliconCloud as unknown as LobeIconModule,
  zai: ZAI as unknown as LobeIconModule,
};

function asIconComponent(value: unknown): ComponentType<LobeIconProps> | null {
  if (typeof value === "function") {
    return value as ComponentType<LobeIconProps>;
  }

  if (typeof value === "object" && value !== null) {
    return value as ComponentType<LobeIconProps>;
  }

  return null;
}

export function ProviderLogo({
  provider,
  size = 16,
}: {
  provider: string;
  size?: number;
}) {
  const style = { width: size, height: size };
  const LobeIcon = LOBE_PROVIDER_ICONS[provider];

  if (LobeIcon) {
    const PreferredIcon =
      asIconComponent(LobeIcon.Color) ??
      asIconComponent(LobeIcon.Avatar) ??
      asIconComponent(LobeIcon.default) ??
      asIconComponent(LobeIcon);

    if (PreferredIcon) {
      return <PreferredIcon size={size} style={{ flex: "none" }} />;
    }
  }

  if (provider === "nexu") {
    return (
      <svg
        style={style}
        viewBox="0 0 800 800"
        fill="currentColor"
        role="img"
        aria-label="Nexu"
      >
        <path d="M193.435 0C300.266 0 386.869 86.6036 386.869 193.435V345.42C386.869 368.312 368.311 386.87 345.419 386.87H41.4502C18.5579 386.87 0 368.311 0 345.419V193.435C0 86.6036 86.6036 0 193.435 0ZM180.539 206.328V386.867H206.331V206.328H180.539Z" />
        <path d="M606.095 799.53C499.264 799.53 412.661 712.926 412.661 606.095L412.661 454.11C412.661 431.217 431.219 412.659 454.111 412.659L758.08 412.659C780.972 412.659 799.53 431.218 799.53 454.111L799.53 606.095C799.53 712.926 712.926 799.53 606.095 799.53ZM618.991 593.2L618.991 412.661L593.2 412.661L593.2 593.2L618.991 593.2Z" />
        <path d="M799.531 193.447C799.531 193.551 799.53 193.655 799.53 193.759L799.53 193.134C799.53 193.238 799.531 193.343 799.531 193.447ZM412.662 193.447C412.662 86.6158 499.265 0.0122032 606.096 0.0121986C708.589 0.0121941 792.462 79.725 799.105 180.537L618.991 180.537L618.991 206.329L799.107 206.329C792.478 307.154 708.598 386.881 606.096 386.881C499.265 386.881 412.662 300.278 412.662 193.447Z" />
        <path d="M-8.45487e-06 606.105C-1.0587e-05 557.327 18.0554 512.768 47.8447 478.741L148.407 579.303L166.645 561.066L66.082 460.504C100.109 430.715 144.667 412.66 193.444 412.66C240.179 412.66 283.043 429.237 316.478 456.83L212.225 561.084L230.462 579.322L335.244 474.538C367.28 509.055 386.869 555.285 386.869 606.09C386.869 654.866 368.812 699.424 339.022 733.45L227.657 622.084L209.42 640.322L320.784 751.688C286.758 781.475 242.203 799.53 193.43 799.53C142.628 799.53 96.4006 779.944 61.8848 747.913L169.45 640.348L151.213 622.111L44.1758 729.148C16.5783 695.712 1.56674e-05 652.844 -8.45487e-06 606.105Z" />
      </svg>
    );
  }

  return (
    <span
      className="flex items-center justify-center rounded text-[9px] font-bold bg-surface-3 text-text-muted"
      style={style}
    >
      {(provider[0] ?? "?").toUpperCase()}
    </span>
  );
}
