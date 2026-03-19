import crypto from "node:crypto";
import type { CreateArtifactInput, UpdateArtifactInput } from "@nexu/shared";
import type { ControllerEnv } from "../app/env.js";
import { LowDbStore } from "./lowdb-store.js";
import {
  type ArtifactsIndex,
  type ControllerArtifact,
  artifactsIndexSchema,
} from "./schemas.js";

function now(): string {
  return new Date().toISOString();
}

export class ArtifactsStore {
  private readonly store: LowDbStore<ArtifactsIndex>;

  constructor(env: ControllerEnv) {
    this.store = new LowDbStore<ArtifactsIndex>(
      env.artifactsIndexPath,
      artifactsIndexSchema,
      () => ({
        schemaVersion: 1,
        artifacts: [],
      }),
    );
  }

  async listArtifacts(): Promise<ArtifactsIndex["artifacts"]> {
    const data = await this.store.read();
    return data.artifacts;
  }

  async getArtifact(id: string): Promise<ControllerArtifact | null> {
    const artifacts = await this.listArtifacts();
    return artifacts.find((artifact) => artifact.id === id) ?? null;
  }

  async createArtifact(
    input: CreateArtifactInput,
  ): Promise<ControllerArtifact> {
    const timestamp = now();
    const artifact: ControllerArtifact = {
      id: crypto.randomUUID(),
      botId: input.botId,
      sessionKey: input.sessionKey ?? null,
      channelType: input.channelType ?? null,
      channelId: input.channelId ?? null,
      title: input.title,
      artifactType: input.artifactType ?? null,
      source: input.source ?? null,
      contentType: input.contentType ?? null,
      status: input.status ?? "building",
      previewUrl: input.previewUrl ?? null,
      deployTarget: input.deployTarget ?? null,
      linesOfCode: input.linesOfCode ?? null,
      fileCount: input.fileCount ?? null,
      durationMs: input.durationMs ?? null,
      metadata: input.metadata ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.store.update((data) => ({
      ...data,
      artifacts: [artifact, ...data.artifacts],
    }));

    return artifact;
  }

  async updateArtifact(
    id: string,
    input: UpdateArtifactInput,
  ): Promise<ControllerArtifact | null> {
    let updatedArtifact: ControllerArtifact | null = null;

    await this.store.update((data) => ({
      ...data,
      artifacts: data.artifacts.map((artifact) => {
        if (artifact.id !== id) {
          return artifact;
        }

        updatedArtifact = {
          ...artifact,
          title: input.title ?? artifact.title,
          status: input.status ?? artifact.status,
          previewUrl: input.previewUrl ?? artifact.previewUrl,
          deployTarget: input.deployTarget ?? artifact.deployTarget,
          linesOfCode: input.linesOfCode ?? artifact.linesOfCode,
          fileCount: input.fileCount ?? artifact.fileCount,
          durationMs: input.durationMs ?? artifact.durationMs,
          metadata: input.metadata ?? artifact.metadata,
          updatedAt: now(),
        };

        return updatedArtifact;
      }),
    }));

    return updatedArtifact;
  }

  async deleteArtifact(id: string): Promise<boolean> {
    let deleted = false;

    await this.store.update((data) => ({
      ...data,
      artifacts: data.artifacts.filter((artifact) => {
        if (artifact.id === id) {
          deleted = true;
          return false;
        }

        return true;
      }),
    }));

    return deleted;
  }
}
