import {
  type updateAuthSourceSchema,
  type updateUserProfileSchema,
  userProfileResponseSchema,
} from "@nexu/shared";
import type { z } from "zod";
import type { NexuConfigStore } from "../store/nexu-config-store.js";

export class LocalUserService {
  constructor(private readonly configStore: NexuConfigStore) {}

  async getProfile() {
    return this.configStore.getLocalProfile();
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
