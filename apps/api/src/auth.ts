import type { BetterAuthOptions } from "better-auth";
import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import pg from "pg";
import { sendEmail } from "./lib/email.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://nexu:nexu@localhost:5433/nexu_dev";
const googleAuthEnabled = process.env.BETTER_AUTH_GOOGLE_ENABLE === "true";

// Enable cross-subdomain cookies in production so session cookies set on
// api.nexu.io are readable from nexu.io (the frontend).
const cookieDomain = process.env.COOKIE_DOMAIN; // e.g. ".nexu.io"

const options: BetterAuthOptions = {
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  database: new pg.Pool({ connectionString: databaseUrl }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 600,
      sendVerificationOnSignUp: true,
      async sendVerificationOTP({ email, otp }) {
        await sendEmail({
          to: email,
          subject: "Your Nexu verification code",
          html: `Your verification code is: <strong>${otp}</strong><br>This code expires in 10 minutes.`,
        });
      },
    }),
  ],
  ...(googleAuthEnabled && {
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID ?? "",
        clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      },
    },
  }),
  ...(cookieDomain && {
    advanced: {
      crossSubDomainCookies: {
        enabled: true,
        domain: cookieDomain,
      },
    },
  }),
  trustedOrigins: [process.env.WEB_URL ?? "http://localhost:5173"],
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: googleAuthEnabled ? ["google"] : [],
    },
  },
};

export const auth = betterAuth(options);
