import crypto from "node:crypto";

export interface SkillManifest {
  slug: string;
  source: "inline" | "local-path";
  hash: string;
  generatedAt: string;
}

export function buildSkillManifest(params: {
  slug: string;
  source: "inline" | "local-path";
  files: Record<string, string>;
}): SkillManifest {
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(params.files))
    .digest("hex");

  return {
    slug: params.slug,
    source: params.source,
    hash: `sha256:${hash}`,
    generatedAt: new Date().toISOString(),
  };
}
