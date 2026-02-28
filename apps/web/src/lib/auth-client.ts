import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const authBaseUrl = import.meta.env.VITE_AUTH_BASE_URL;

export const authClient = createAuthClient({
  baseURL: authBaseUrl || undefined,
  plugins: [emailOTPClient()],
});
