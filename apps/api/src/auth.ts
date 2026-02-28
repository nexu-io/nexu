import type { BetterAuthOptions } from "better-auth";
import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import pg from "pg";
import { sendEmail } from "./lib/email.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://nexu:nexu@localhost:5433/nexu_dev";

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
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },
  trustedOrigins: [process.env.WEB_URL ?? "http://localhost:5173"],
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google"],
    },
  },
};

export const auth = betterAuth(options);
