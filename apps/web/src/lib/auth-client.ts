import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const authBaseUrl = import.meta.env.VITE_AUTH_BASE_URL;
const isElectronRenderer =
  typeof navigator !== "undefined" && navigator.userAgent.includes("Electron");
const resolvedAuthBaseUrl = isElectronRenderer ? undefined : authBaseUrl;

export const authClient = createAuthClient({
  baseURL: resolvedAuthBaseUrl || undefined,
  plugins: [emailOTPClient()],
});
