// ─── Platform SVG Icons ─────────────────────────────────────
// Shared across oauth-callback, integrations, and other pages.

import { useId } from "react";

export type PlatformIconName =
  | "slack"
  | "discord"
  | "feishu"
  | "wechat"
  | "openclaw-weixin"
  | "whatsapp"
  | "telegram"
  | "web";

export function SlackIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <title>Slack</title>
      <path
        d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"
        fill="#E01E5A"
      />
      <path
        d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.527 2.527 0 0 1 2.521 2.521 2.527 2.527 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"
        fill="#36C5F0"
      />
      <path
        d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"
        fill="#2EB67D"
      />
      <path
        d="M15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z"
        fill="#ECB22E"
      />
    </svg>
  );
}

export function DiscordIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#5865F2">
      <title>Discord</title>
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

export function FeishuIcon({ size = 16 }: { size?: number }) {
  return (
    <img
      width={size}
      height={size}
      alt="Feishu"
      src="/feishu-logo.png"
      style={{ objectFit: "contain" }}
    />
  );
}

/** WeChat mark only (no wordmark) — from official WeChat-Logo asset; gray text path omitted. */
export function WechatIcon({ size = 16 }: { size?: number }) {
  const rawId = useId().replace(/:/g, "");
  const gradA = `${rawId}-wx-a`;
  const gradB = `${rawId}-wx-b`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 358 278"
      role="img"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>WeChat</title>
      <defs>
        <linearGradient
          id={gradA}
          gradientUnits="userSpaceOnUse"
          gradientTransform="scale(1.0663 .93783)"
          x1="116.889"
          y1="219.859"
          x2="116.889"
          y2="1.019"
        >
          <stop offset="0%" stopColor="#78D431" />
          <stop offset="100%" stopColor="#9EEE69" />
        </linearGradient>
        <linearGradient
          id={gradB}
          gradientUnits="userSpaceOnUse"
          gradientTransform="scale(1.06066 .9428)"
          x1="226.919"
          y1="282.247"
          x2="226.919"
          y2="99.632"
        >
          <stop offset="0%" stopColor="#E4E6E6" />
          <stop offset="100%" stopColor="#F5F5FF" />
        </linearGradient>
      </defs>
      <g fillRule="evenodd" fill="none">
        <path
          fill={`url(#${gradA})`}
          d="M0 103.374c0 31.012 16.907 59.345 43.037 78.105 2.306 1.531 3.458 3.829 3.458 6.892 0 .765-.384 1.914-.384 2.68-1.921 7.657-5.38 20.292-5.764 20.675-.384 1.148-.768 1.914-.768 3.062 0 2.298 1.921 4.212 4.227 4.212.768 0 1.537-.383 2.305-.766l27.283-15.697c1.92-1.149 4.226-1.915 6.532-1.915 1.153 0 2.69 0 3.843.383 12.68 3.829 26.513 5.743 40.731 5.743 68.782 0 124.5-46.327 124.5-103.374S193.282 0 124.5 0 0 46.327 0 103.374"
        />
        <path
          fill={`url(#${gradB})`}
          d="M240.5 267.585c11.883 0 23.383-1.543 33.733-4.629.767-.386 1.917-.386 3.067-.386 1.917 0 3.833.772 5.367 1.543l22.616 13.116c.767.385 1.15.771 1.917.771a3.447 3.447 0 003.45-3.472c0-.771-.383-1.543-.383-2.7 0-.386-3.067-10.8-4.6-17.358-.384-.772-.384-1.543-.384-2.315 0-2.314 1.15-4.243 3.067-5.786C330.2 230.553 344 207.023 344 180.792 344 132.96 297.617 94 240.5 94S137 132.574 137 180.792c0 47.833 46.383 86.793 103.5 86.793z"
        />
        <path
          fill="#187E28"
          d="M99 70c0 8.93-7.07 16-16 16s-16-7.07-16-16 7.07-16 16-16 16 7.07 16 16m83 0c0 8.93-7.07 16-16 16s-16-7.07-16-16 7.07-16 16-16 16 7.07 16 16"
        />
        <path
          fill="#858C8C"
          d="M262 154c0 7.778 6.222 14 14 14s14-6.222 14-14-6.222-14-14-14-14 6.222-14 14m-69 0c0 7.778 6.222 14 14 14s14-6.222 14-14-6.222-14-14-14-14 6.222-14 14"
        />
      </g>
    </svg>
  );
}

export function WhatsAppIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img">
      <title>WhatsApp</title>
      <path
        fill="#25D366"
        d="M20.52 3.48A11.9 11.9 0 0 0 12.06 0C5.51 0 .18 5.33.18 11.88c0 2.09.55 4.13 1.6 5.94L0 24l6.37-1.67a11.83 11.83 0 0 0 5.69 1.45h.01c6.55 0 11.88-5.33 11.88-11.88 0-3.17-1.23-6.14-3.43-8.42Z"
      />
      <path
        fill="#fff"
        d="M17.63 14.15c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.19.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.25-.46-2.38-1.47a8.95 8.95 0 0 1-1.65-2.05c-.17-.3-.02-.46.13-.62.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.48-.5-.67-.5h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.5s1.07 2.9 1.22 3.1c.15.2 2.1 3.2 5.08 4.49.71.31 1.27.5 1.7.63.72.23 1.37.2 1.88.12.57-.08 1.76-.72 2.01-1.42.25-.7.25-1.3.18-1.42-.08-.12-.28-.2-.58-.35Z"
      />
    </svg>
  );
}

export function TelegramIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img">
      <title>Telegram</title>
      <circle cx="12" cy="12" r="12" fill="#24A1DE" />
      <path
        fill="#fff"
        d="m17.34 6.88-2.08 10.16c-.16.72-.58.9-1.17.56l-3.23-2.38-1.56 1.5c-.17.17-.32.32-.65.32l.23-3.3 6-5.42c.26-.23-.05-.36-.4-.13l-7.42 4.67-3.2-1c-.7-.22-.71-.7.15-1.04l12.5-4.82c.58-.22 1.09.13.9 1.88Z"
      />
    </svg>
  );
}

export function WebIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img">
      <title>Web</title>
      <circle cx="12" cy="12" r="10" stroke="#6B7280" strokeWidth="1.75" />
      <path
        d="M2 12h20M12 2a14.5 14.5 0 0 0 0 20M12 2a14.5 14.5 0 0 1 0 20"
        stroke="#6B7280"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PlatformIcon({
  platform,
  size = 16,
}: {
  platform: string;
  size?: number;
}) {
  switch (platform as PlatformIconName) {
    case "slack":
      return <SlackIcon size={size} />;
    case "discord":
      return <DiscordIcon size={size} />;
    case "feishu":
      return <FeishuIcon size={size} />;
    case "wechat":
    case "openclaw-weixin":
      return <WechatIcon size={size} />;
    case "whatsapp":
      return <WhatsAppIcon size={size} />;
    case "telegram":
      return <TelegramIcon size={size} />;
    default:
      return <WebIcon size={size} />;
  }
}

export function GoogleIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <title>Google</title>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
