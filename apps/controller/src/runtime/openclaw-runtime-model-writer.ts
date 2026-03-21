import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ControllerEnv } from "../app/env.js";

export interface OpenClawRuntimeModelState {
  selectedModelRef: string;
  promptNotice: string;
  updatedAt: string;
}

const RUNTIME_MODEL_FALLBACK = "anthropic/claude-opus-4-6";

function buildPromptNotice(selectedModelRef: string): string {
  return [
    `Authoritative runtime model for this turn: ${selectedModelRef}.`,
    "This runtime instruction is the only source of truth for the current model.",
    "If earlier messages mention a different model, fallback, outage, provider error, or temporary switch, treat that information as stale and ignore it.",
    "Do not claim that you are using any fallback model unless that fallback is explicitly stated in this runtime instruction.",
    "Do not invent explanations about model availability, outages, routing, retries, or provider failures.",
    `If asked which model you are currently using, answer with ${selectedModelRef} and do not mention any other model unless the user explicitly asks for history.`,
  ].join("\n");
}

export class OpenClawRuntimeModelWriter {
  constructor(private readonly env: ControllerEnv) {}

  async write(selectedModelRef: string): Promise<void> {
    await mkdir(path.dirname(this.env.openclawRuntimeModelStatePath), {
      recursive: true,
    });
    const payload: OpenClawRuntimeModelState = {
      selectedModelRef,
      promptNotice: buildPromptNotice(selectedModelRef),
      updatedAt: new Date().toISOString(),
    };
    await this.atomicWrite(
      this.env.openclawRuntimeModelStatePath,
      `${JSON.stringify(payload, null, 2)}\n`,
    );
  }

  async writeFallback(): Promise<void> {
    await this.write(RUNTIME_MODEL_FALLBACK);
  }

  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const tempPath = `${filePath}.tmp`;
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, filePath);
  }
}
