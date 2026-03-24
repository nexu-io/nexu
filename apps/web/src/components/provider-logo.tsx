import Anthropic from "@lobehub/icons/es/Anthropic";
import ChatGLM from "@lobehub/icons/es/ChatGLM";
import Claude from "@lobehub/icons/es/Claude";
import CommandA from "@lobehub/icons/es/CommandA";
import DeepSeek from "@lobehub/icons/es/DeepSeek";
import Gemini from "@lobehub/icons/es/Gemini";
import Gemma from "@lobehub/icons/es/Gemma";
import Grok from "@lobehub/icons/es/Grok";
import Kimi from "@lobehub/icons/es/Kimi";
import LLaVA from "@lobehub/icons/es/LLaVA";
import Minimax from "@lobehub/icons/es/Minimax";
import Mistral from "@lobehub/icons/es/Mistral";
import OpenAI from "@lobehub/icons/es/OpenAI";
import OpenRouter from "@lobehub/icons/es/OpenRouter";
import PPIO from "@lobehub/icons/es/PPIO";
import Qwen from "@lobehub/icons/es/Qwen";
import SiliconCloud from "@lobehub/icons/es/SiliconCloud";
import ZAI from "@lobehub/icons/es/ZAI";
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
  glm: ChatGLM as unknown as LobeIconModule,
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

const MODEL_ICON_MATCHERS: Array<{
  matches: (value: string) => boolean;
  icon: LobeIconModule;
}> = [
  {
    matches: (value) => matchesAnyKeyword(value, ["claude"]),
    icon: Claude as unknown as LobeIconModule,
  },
  {
    matches: (value) => matchesAnyKeyword(value, ["gemini"]),
    icon: Gemini as unknown as LobeIconModule,
  },
  {
    matches: (value) =>
      matchesAnyKeyword(value, ["gpt", "chatgpt"]) ||
      matchesAnyPrefix(value, ["o1", "o3", "o4"]),
    icon: OpenAI as unknown as LobeIconModule,
  },
  {
    matches: (value) => matchesAnyKeyword(value, ["deepseek"]),
    icon: DeepSeek as unknown as LobeIconModule,
  },
  {
    matches: (value) => matchesAnyKeyword(value, ["qwen"]),
    icon: Qwen as unknown as LobeIconModule,
  },
  {
    matches: (value) => matchesAnyKeyword(value, ["glm", "chatglm", "zhipu"]),
    icon: ChatGLM as unknown as LobeIconModule,
  },
  {
    matches: (value) => matchesAnyKeyword(value, ["kimi", "moonshot"]),
    icon: Kimi as unknown as LobeIconModule,
  },
  {
    matches: (value) => matchesAnyKeyword(value, ["minimax"]),
    icon: Minimax as unknown as LobeIconModule,
  },
  {
    matches: (value) => matchesAnyKeyword(value, ["llama", "llava"]),
    icon: LLaVA as unknown as LobeIconModule,
  },
  {
    matches: (value) => matchesAnyKeyword(value, ["grok", "xai"]),
    icon: Grok as unknown as LobeIconModule,
  },
  {
    matches: (value) =>
      matchesAnyKeyword(value, ["mistral", "mixtral", "magistral"]),
    icon: Mistral as unknown as LobeIconModule,
  },
  {
    matches: (value) => matchesAnyKeyword(value, ["gemma"]),
    icon: Gemma as unknown as LobeIconModule,
  },
  {
    matches: (value) =>
      matchesAnyKeyword(value, [
        "command-a",
        "commanda",
        "command r",
        "command-r",
      ]),
    icon: CommandA as unknown as LobeIconModule,
  },
  {
    matches: (value) => matchesAnyKeyword(value, ["openrouter"]),
    icon: OpenRouter as unknown as LobeIconModule,
  },
];

function asIconComponent(value: unknown): ComponentType<LobeIconProps> | null {
  if (typeof value === "function") {
    return value as ComponentType<LobeIconProps>;
  }

  if (typeof value === "object" && value !== null) {
    return value as ComponentType<LobeIconProps>;
  }

  return null;
}

function getPreferredIcon(lobeIcon: LobeIconModule | undefined) {
  if (!lobeIcon) {
    return null;
  }

  return (
    asIconComponent(lobeIcon.Color) ??
    asIconComponent(lobeIcon.Avatar) ??
    asIconComponent(lobeIcon.default) ??
    asIconComponent(lobeIcon)
  );
}

function normalizeIconLookupValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

function matchesAnyKeyword(value: string, keywords: string[]) {
  return keywords.some((keyword) =>
    value.includes(normalizeIconLookupValue(keyword)),
  );
}

function matchesAnyPrefix(value: string, prefixes: string[]) {
  const tokens = value.split(" ");
  return prefixes.some((prefix) =>
    tokens.some((token) => token.startsWith(prefix)),
  );
}

export function ProviderLogo({
  provider,
  size = 16,
}: {
  provider: string;
  size?: number;
}) {
  const style = { width: size, height: size };
  const lobeIcon = LOBE_PROVIDER_ICONS[provider];

  if (lobeIcon) {
    const PreferredIcon = getPreferredIcon(lobeIcon);

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
        aria-label="nexu"
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

export function ModelLogo({
  model,
  provider,
  size = 16,
}: {
  model: string;
  provider?: string;
  size?: number;
}) {
  const normalizedModel = normalizeIconLookupValue(model);
  const matchedIcon = MODEL_ICON_MATCHERS.find(({ matches }) =>
    matches(normalizedModel),
  )?.icon;
  const PreferredIcon = getPreferredIcon(matchedIcon);

  if (PreferredIcon) {
    return <PreferredIcon size={size} style={{ flex: "none" }} />;
  }

  if (provider) {
    return <ProviderLogo provider={provider} size={size} />;
  }

  return (
    <span
      className="flex items-center justify-center rounded text-[9px] font-bold bg-surface-3 text-text-muted"
      style={{ width: size, height: size }}
    >
      {(model[0] ?? "?").toUpperCase()}
    </span>
  );
}
