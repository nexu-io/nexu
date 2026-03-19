import type { CreateArtifactInput, UpdateArtifactInput } from "@nexu/shared";
import type { ArtifactsStore } from "../store/artifacts-store.js";

export class ArtifactService {
  constructor(private readonly artifactsStore: ArtifactsStore) {}

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
}
