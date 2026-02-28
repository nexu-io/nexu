const DEFAULT_WHATSAPP_WA_ME_URL =
  "https://wa.me/15551846745?text=Hello%20Nexu";

export const whatsappWaMeUrl =
  import.meta.env.VITE_WHATSAPP_WA_ME_URL?.trim() || DEFAULT_WHATSAPP_WA_ME_URL;

export const whatsappQrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(whatsappWaMeUrl)}`;
