import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";

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
    logger.info(
      {
        path: this.env.openclawRuntimeModelStatePath,
        selectedModelRef,
      },
      "runtime_model_write_begin",
    );
    await writeFile(
      this.env.openclawRuntimeModelStatePath,
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8",
    );
    logger.info(
      {
        path: this.env.openclawRuntimeModelStatePath,
        selectedModelRef,
      },
      "runtime_model_write_complete",
    );
  }

  async writeFallback(): Promise<void> {
    await this.write(RUNTIME_MODEL_FALLBACK);
  }
}
