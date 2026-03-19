import {
  type updateAuthSourceSchema,
  type updateUserProfileSchema,
  userProfileResponseSchema,
} from "@nexu/shared";
import { z } from "zod";
import type { NexuConfigStore } from "../store/nexu-config-store.js";

const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  image: z.string().nullable().optional(),
});

export class LocalUserService {
  constructor(private readonly configStore: NexuConfigStore) {}

  async getProfile() {
    return this.configStore.getLocalProfile();
  }

  async getSession() {
    const profile = await this.getProfile();
    return {
      user: sessionUserSchema.parse({
        id: profile.id,
        email: profile.email,
        name: profile.name,
        image: profile.image ?? null,
      }),
      session: {
        id: "desktop-local-session",
      },
    };
  }

  async signIn() {
    return this.getSession();
  }

  async signUp() {
    return this.getSession();
  }

  async updateProfile(input: UpdateUserProfileInput) {
    const profile = await this.configStore.updateLocalProfile(input);
    return {
      ok: true,
      profile: userProfileResponseSchema.parse(profile),
    };
  }

  async updateAuthSource(input: UpdateAuthSourceInput) {
    await this.configStore.updateLocalAuthSource(input);
    return {
      ok: true,
    };
  }
}

type UpdateUserProfileInput = z.infer<typeof updateUserProfileSchema>;
type UpdateAuthSourceInput = z.infer<typeof updateAuthSourceSchema>;
