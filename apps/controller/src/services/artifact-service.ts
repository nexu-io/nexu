import { lstat, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CreateArtifactInput, UpdateArtifactInput } from "@nexu/shared";
import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";
import type { ArtifactsStore } from "../store/artifacts-store.js";
import type { ControllerArtifact } from "../store/schemas.js";

export class ArtifactService {
  constructor(
    private readonly artifactsStore: ArtifactsStore,
    private readonly env: ControllerEnv,
  ) {}

  async listArtifacts(params: {
    limit: number;
    offset: number;
    sessionKey?: string;
  }) {
    let artifacts = await this.artifactsStore.listArtifacts();
    if (params.sessionKey) {
      artifacts = artifacts.filter(
        (artifact) => artifact.sessionKey === params.sessionKey,
      );
    }
    return {
      artifacts: artifacts.slice(params.offset, params.offset + params.limit),
      total: artifacts.length,
      limit: params.limit,
      offset: params.offset,
    };
  }

  async getArtifact(id: string) {
    return this.artifactsStore.getArtifact(id);
  }

  async createArtifact(input: CreateArtifactInput) {
    return this.artifactsStore.createArtifact(input);
  }

  async updateArtifact(id: string, input: UpdateArtifactInput) {
    return this.artifactsStore.updateArtifact(id, input);
  }

  async deleteArtifact(id: string) {
    return this.artifactsStore.deleteArtifact(id);
  }

  async deleteArtifactsForSession(
    botId: string,
    sessionKey: string,
  ): Promise<{
    deletedArtifacts: number;
    deletedFiles: number;
  }> {
    const sessionArtifacts = (await this.artifactsStore.listArtifacts()).filter(
      (artifact) =>
        artifact.botId === botId && artifact.sessionKey === sessionKey,
    );
    const removableArtifactIds: string[] = [];
    let deletedFiles = 0;

    for (const artifact of sessionArtifacts) {
      const filePaths = this.collectManagedFilePaths(
        artifact,
        botId,
        sessionKey,
      );
      let hasCleanupFailure = false;

      for (const filePath of filePaths) {
        try {
          const stats = await lstat(filePath);
          if (stats.isDirectory()) {
            hasCleanupFailure = true;
            logger.warn(
              {
                artifactId: artifact.id,
                botId,
                sessionKey,
                filePath,
              },
              "session_delete_artifact_cleanup_skipped_directory_path",
            );
            continue;
          }

          await rm(filePath, {
            force: true,
          });
          deletedFiles += 1;
        } catch (error) {
          const errorCode =
            error instanceof Error && "code" in error
              ? String(error.code)
              : undefined;
          if (errorCode === "ENOENT") {
            continue;
          }

          hasCleanupFailure = true;
          logger.warn(
            {
              artifactId: artifact.id,
              botId,
              sessionKey,
              filePath,
              error: error instanceof Error ? error.message : String(error),
            },
            "session_delete_artifact_file_cleanup_failed",
          );
        }
      }

      if (!hasCleanupFailure) {
        removableArtifactIds.push(artifact.id);
      }
    }

    const deletedArtifacts =
      await this.artifactsStore.deleteArtifactsByIds(removableArtifactIds);

    const retainedArtifacts = sessionArtifacts.length - deletedArtifacts;
    if (retainedArtifacts > 0) {
      logger.warn(
        {
          botId,
          sessionKey,
          retainedArtifacts,
        },
        "session_delete_artifact_index_retained_for_retry",
      );
    }

    return {
      deletedArtifacts,
      deletedFiles,
    };
  }

  async getStats() {
    const artifacts = await this.artifactsStore.listArtifacts();
    return {
      totalArtifacts: artifacts.length,
      liveCount: artifacts.filter((artifact) => artifact.status === "live")
        .length,
      buildingCount: artifacts.filter(
        (artifact) => artifact.status === "building",
      ).length,
      failedCount: artifacts.filter((artifact) => artifact.status === "failed")
        .length,
      codingCount: artifacts.filter((artifact) => artifact.source === "coding")
        .length,
      contentCount: artifacts.filter(
        (artifact) => artifact.source === "content",
      ).length,
      totalLinesOfCode: artifacts.reduce(
        (total, artifact) => total + (artifact.linesOfCode ?? 0),
        0,
      ),
    };
  }

  private collectManagedFilePaths(
    artifact: ControllerArtifact,
    botId: string,
    sessionKey: string,
  ): string[] {
    const candidatePaths = new Set<string>();

    this.addCandidatePath(candidatePaths, artifact.previewUrl);
    this.addCandidateFromMetadata(candidatePaths, artifact.metadata);

    return [...candidatePaths].filter((candidate) =>
      this.isSessionOwnedArtifactPath(
        candidate,
        botId,
        sessionKey,
        artifact.id,
      ),
    );
  }

  private addCandidateFromMetadata(
    candidatePaths: Set<string>,
    metadata: Record<string, unknown> | null,
  ): void {
    if (!metadata) {
      return;
    }

    const directKeys = [
      "filePath",
      "localPath",
      "outputPath",
      "artifactPath",
      "imagePath",
      "previewPath",
    ] as const;

    for (const key of directKeys) {
      this.addCandidateUnknown(candidatePaths, metadata[key]);
    }

    const nestedKeys = ["files", "outputs", "artifacts"] as const;
    for (const key of nestedKeys) {
      this.addCandidateUnknown(candidatePaths, metadata[key]);
    }
  }

  private addCandidateUnknown(
    candidatePaths: Set<string>,
    value: unknown,
  ): void {
    if (typeof value === "string") {
      this.addCandidatePath(candidatePaths, value);
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        this.addCandidateUnknown(candidatePaths, item);
      }
      return;
    }

    if (typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      this.addCandidateUnknown(candidatePaths, record.filePath);
      this.addCandidateUnknown(candidatePaths, record.localPath);
      this.addCandidateUnknown(candidatePaths, record.outputPath);
      this.addCandidateUnknown(candidatePaths, record.artifactPath);
      this.addCandidateUnknown(candidatePaths, record.imagePath);
      this.addCandidateUnknown(candidatePaths, record.previewPath);
    }
  }

  private addCandidatePath(
    candidatePaths: Set<string>,
    value: string | null | undefined,
  ): void {
    const normalized = this.parseLocalPath(value);
    if (normalized) {
      candidatePaths.add(normalized);
    }
  }

  private parseLocalPath(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }

    if (value.startsWith("file://")) {
      try {
        return path.resolve(fileURLToPath(value));
      } catch {
        return null;
      }
    }

    if (/^[a-z]+:\/\//i.test(value)) {
      return null;
    }

    if (!path.isAbsolute(value)) {
      return null;
    }

    return path.resolve(value);
  }

  private isSessionOwnedArtifactPath(
    candidate: string,
    botId: string,
    sessionKey: string,
    artifactId: string,
  ): boolean {
    const artifactsRoot = path.resolve(
      path.dirname(this.env.artifactsIndexPath),
    );
    if (candidate === artifactsRoot) {
      return false;
    }

    const relative = path.relative(artifactsRoot, candidate);
    if (
      relative.length === 0 ||
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    ) {
      return false;
    }

    const lowerRelative = relative.toLowerCase();
    const scopeTokens = [sessionKey, botId, artifactId]
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token.length > 0);

    return scopeTokens.some((token) => lowerRelative.includes(token));
  }
}
