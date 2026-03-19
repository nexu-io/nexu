import { resolve } from "node:path";

export function getOpenclawSkillsDir(userDataPath: string): string {
  return resolve(userDataPath, "runtime/openclaw/state/skills");
}

export function getSkillhubCacheDir(userDataPath: string): string {
  return resolve(userDataPath, "runtime/skillhub-cache");
}

export function getOpenclawCuratedSkillsDir(userDataPath: string): string {
  return resolve(userDataPath, "runtime/openclaw/state/bundled-skills");
}
