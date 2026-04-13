import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_PATH_NORMALIZATION_VERSION = 1;
const base64Chars =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const base64Map = new Map(
  [...base64Chars].map((value, index) => [value, index]),
);

function parseArgs(argv) {
  const args = {
    captureDir:
      process.env.NEXU_DESKTOP_E2E_CAPTURE_DIR ??
      path.resolve(process.cwd(), "captures"),
    artifactsDir: path.resolve(process.cwd(), "artifacts"),
    repoRoot: path.resolve(process.cwd(), "..", ".."),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--capture-dir") {
      args.captureDir = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--artifacts-dir") {
      args.artifactsDir = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--repo-root") {
      args.repoRoot = path.resolve(argv[index + 1]);
      index += 1;
    }
  }

  return args;
}

function log(message) {
  process.stderr.write(`[coverage:merge] ${message}\n`);
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  if (!(await exists(filePath))) {
    return null;
  }
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function walkFiles(rootDir) {
  if (!(await exists(rootDir))) {
    return [];
  }

  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        return walkFiles(entryPath);
      }
      return [entryPath];
    }),
  );
  return files.flat().sort();
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function fromFileUrl(value) {
  if (typeof value !== "string") {
    return null;
  }
  if (value.startsWith("file://")) {
    try {
      return fileURLToPath(value);
    } catch {
      return value;
    }
  }
  return value;
}

function decodeVlq(mappings) {
  const result = [];
  let value = 0;
  let shift = 0;

  for (const character of mappings) {
    if (character === "," || character === ";") {
      if (shift !== 0) {
        throw new Error(`Invalid sourcemap mapping near '${character}'`);
      }
      result.push(character);
      continue;
    }

    const digit = base64Map.get(character);
    if (digit === undefined) {
      throw new Error(`Unsupported sourcemap base64 digit '${character}'`);
    }
    const continuation = (digit & 32) !== 0;
    const digitValue = digit & 31;
    value += digitValue << shift;
    shift += 5;

    if (!continuation) {
      const isNegative = (value & 1) === 1;
      const decoded = value >> 1;
      result.push(isNegative ? -decoded : decoded);
      value = 0;
      shift = 0;
    }
  }

  if (shift !== 0) {
    throw new Error("Incomplete sourcemap VLQ sequence");
  }

  return result;
}

function parseMappings(mappings) {
  const decoded = decodeVlq(mappings);
  const lines = [];
  let generatedLine = [];
  let generatedColumn = 0;
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let nameIndex = 0;

  for (let index = 0; index < decoded.length; ) {
    const token = decoded[index];
    if (token === ";") {
      lines.push(generatedLine);
      generatedLine = [];
      generatedColumn = 0;
      index += 1;
      continue;
    }
    if (token === ",") {
      index += 1;
      continue;
    }

    generatedColumn += decoded[index++];
    const segment = { generatedColumn };

    if (
      index < decoded.length &&
      decoded[index] !== "," &&
      decoded[index] !== ";"
    ) {
      sourceIndex += decoded[index++];
      originalLine += decoded[index++];
      originalColumn += decoded[index++];
      segment.sourceIndex = sourceIndex;
      segment.originalLine = originalLine;
      segment.originalColumn = originalColumn;
      if (
        index < decoded.length &&
        decoded[index] !== "," &&
        decoded[index] !== ";"
      ) {
        nameIndex += decoded[index++];
        segment.nameIndex = nameIndex;
      }
    }

    generatedLine.push(segment);
  }

  lines.push(generatedLine);
  return lines;
}

function lineLengthsFromContent(content) {
  const lineLengths = [];
  let current = 0;
  for (let index = 0; index < content.length; index += 1) {
    current += 1;
    if (content[index] === "\n") {
      lineLengths.push(current);
      current = 0;
    }
  }
  if (current > 0 || content.length === 0) {
    lineLengths.push(current);
  }
  return lineLengths;
}

function offsetsToLineCoverage(lineLengths, ranges) {
  const starts = [];
  let offset = 0;
  for (const lineLength of lineLengths) {
    starts.push(offset);
    offset += lineLength;
  }

  const lineHits = new Map();
  for (const range of ranges) {
    if (
      !range ||
      typeof range.startOffset !== "number" ||
      typeof range.endOffset !== "number"
    ) {
      continue;
    }
    if ((range.count ?? 0) <= 0) {
      continue;
    }
    const endOffset = Math.max(range.startOffset, range.endOffset - 1);
    for (let index = 0; index < starts.length; index += 1) {
      const lineStart = starts[index];
      const lineEnd = lineStart + lineLengths[index];
      if (endOffset < lineStart) {
        break;
      }
      if (range.startOffset >= lineEnd) {
        continue;
      }
      const nextValue = Math.max(
        lineHits.get(index + 1) ?? 0,
        range.count ?? 0,
      );
      lineHits.set(index + 1, nextValue);
    }
  }

  return lineHits;
}

export function normalizeRelativePath(filePath, repoRoot) {
  const relativePath = toPosixPath(path.relative(repoRoot, filePath));
  if (relativePath.startsWith("..")) {
    return null;
  }
  if (relativePath.includes("/node_modules/")) {
    return null;
  }
  if (
    !/^(apps\/desktop\/(main|preload|src|shared)\/|apps\/controller\/src\/|apps\/web\/src\/)/.test(
      relativePath,
    )
  ) {
    return null;
  }
  return relativePath;
}

function resolveSourcePath({
  repoRoot,
  compiledRepoPath,
  sourceRoot,
  sourcePath,
}) {
  if (typeof sourcePath !== "string" || sourcePath.length === 0) {
    return null;
  }

  const normalizedSourcePath = fromFileUrl(sourcePath) ?? sourcePath;
  if (path.isAbsolute(normalizedSourcePath)) {
    return normalizeRelativePath(
      path.normalize(normalizedSourcePath),
      repoRoot,
    );
  }

  const compiledDir = compiledRepoPath
    ? path.dirname(path.join(repoRoot, compiledRepoPath))
    : repoRoot;
  const sourceRootPath = sourceRoot
    ? path.resolve(compiledDir, sourceRoot)
    : compiledDir;
  return normalizeRelativePath(
    path.resolve(sourceRootPath, normalizedSourcePath),
    repoRoot,
  );
}

async function buildArtifactSourceMapsIndex({ artifactsDir, repoRoot }) {
  const sourceMapsRoot = path.join(artifactsDir, "source-maps");
  const files = await walkFiles(sourceMapsRoot);
  const mapIndex = [];

  for (const filePath of files) {
    if (!filePath.endsWith(".map")) {
      continue;
    }
    const fileContent = await readFile(filePath, "utf8");
    const sourceMap = JSON.parse(fileContent);
    const compiledArtifactPath = filePath.slice(0, -4);
    const sourceMapsRelative = toPosixPath(
      path.relative(sourceMapsRoot, compiledArtifactPath),
    );
    const compiledRepoPath = resolveCompiledRepoPath(sourceMapsRelative);
    const matchSuffixes = buildArtifactMatchSuffixes(sourceMapsRelative);
    if (!compiledRepoPath || matchSuffixes.length === 0) {
      continue;
    }
    const compiledContent = (await exists(compiledArtifactPath))
      ? await readFile(compiledArtifactPath, "utf8")
      : null;
    mapIndex.push({
      kind: "artifact",
      compiledRepoPath,
      compiledContent,
      lineLengths: compiledContent
        ? lineLengthsFromContent(compiledContent)
        : null,
      sourceMap,
      sourceMapLines: parseMappings(sourceMap.mappings ?? ""),
      sourceMapPath: filePath,
      matchSuffixes,
      repoRoot,
    });
  }

  return mapIndex;
}

export function resolveCompiledRepoPath(sourceMapsRelative) {
  if (sourceMapsRelative.startsWith("dist/")) {
    return `apps/desktop/${sourceMapsRelative}`;
  }
  if (sourceMapsRelative.startsWith("dist-electron/")) {
    return `apps/desktop/${sourceMapsRelative}`;
  }
  if (sourceMapsRelative.startsWith("web-dist/")) {
    return `apps/web/dist/${sourceMapsRelative.slice("web-dist/".length)}`;
  }
  return null;
}

export function buildArtifactMatchSuffixes(sourceMapsRelative) {
  const suffixes = new Set([sourceMapsRelative]);

  if (sourceMapsRelative.startsWith("dist/")) {
    suffixes.add(sourceMapsRelative.slice("dist/".length));
  }

  if (sourceMapsRelative.startsWith("web-dist/")) {
    suffixes.add(sourceMapsRelative.slice("web-dist/".length));
  }

  return [...suffixes].filter(Boolean);
}

function normalizeCompiledRepoPath(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    return null;
  }

  const normalized = toPosixPath(relativePath.replace(/\\/g, "/"));
  if (
    normalized.startsWith("apps/controller/dist/") ||
    normalized.startsWith("apps/desktop/dist-electron/main/") ||
    normalized.startsWith("apps/desktop/dist-electron/preload/")
  ) {
    return normalized;
  }

  return null;
}

export function resolveNodeCompiledRepoPath(url, repoRoot) {
  const normalizedUrl = toPosixPath(
    (fromFileUrl(url) ?? url ?? "").replace(/\\/g, "/"),
  );

  if (!normalizedUrl) {
    return null;
  }

  const normalizedFromRepo = normalizeCompiledRepoPath(
    normalizeRelativePath(path.normalize(normalizedUrl), repoRoot),
  );
  if (normalizedFromRepo) {
    return normalizedFromRepo;
  }

  const suffixMappings = [
    ["/dist-electron/main/", "apps/desktop/dist-electron/main/"],
    ["/dist-electron/preload/", "apps/desktop/dist-electron/preload/"],
    ["/runtime/controller-sidecar/dist/", "apps/controller/dist/"],
    ["/controller-sidecar/dist/", "apps/controller/dist/"],
    ["/runtime/controller/dist/", "apps/controller/dist/"],
    ["/apps/controller/dist/", "apps/controller/dist/"],
    ["/controller/dist/", "apps/controller/dist/"],
  ];

  for (const [needle, prefix] of suffixMappings) {
    const markerIndex = normalizedUrl.lastIndexOf(needle);
    if (markerIndex === -1) {
      continue;
    }

    const suffix = normalizedUrl.slice(markerIndex + needle.length);
    return normalizeCompiledRepoPath(`${prefix}${suffix}`);
  }

  return null;
}

export function pickArtifactSourceMap(url, mapIndex) {
  if (typeof url !== "string") {
    return null;
  }

  const normalized = toPosixPath((fromFileUrl(url) ?? url).replace(/\\/g, "/"));
  const ranked = mapIndex
    .flatMap((entry) =>
      entry.matchSuffixes
        .filter((suffix) => normalized.endsWith(suffix))
        .map((suffix) => ({ entry, suffix })),
    )
    .sort((left, right) => right.suffix.length - left.suffix.length);

  return ranked[0]?.entry ?? null;
}

export function getNodeSourceMapEntry(rawNodeCoverage, url, repoRoot) {
  const cache = rawNodeCoverage?.["source-map-cache"];
  if (!cache || typeof cache !== "object") {
    return null;
  }
  const entry = cache[url];
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const sourceMap =
    typeof entry.data === "string" ? JSON.parse(entry.data) : entry.data;
  if (!sourceMap || typeof sourceMap !== "object") {
    return null;
  }
  return {
    kind: "node-v8",
    compiledRepoPath: resolveNodeCompiledRepoPath(url, repoRoot),
    compiledContent: null,
    lineLengths: Array.isArray(entry.lineLengths) ? entry.lineLengths : null,
    sourceMap,
    sourceMapLines: parseMappings(sourceMap.mappings ?? ""),
    sourceMapPath: null,
    repoRoot: null,
    sourceRoot: entry.sourceRoot ?? sourceMap.sourceRoot ?? "",
  };
}

function flattenRanges(functions) {
  const ranges = [];
  for (const fn of Array.isArray(functions) ? functions : []) {
    for (const range of Array.isArray(fn.ranges) ? fn.ranges : []) {
      ranges.push(range);
    }
  }
  return ranges;
}

function ensureFileCoverage(coverageByFile, relativePath) {
  let fileCoverage = coverageByFile.get(relativePath);
  if (!fileCoverage) {
    fileCoverage = {
      path: relativePath,
      executableLines: new Set(),
      coveredLines: new Map(),
      generatedSources: new Set(),
    };
    coverageByFile.set(relativePath, fileCoverage);
  }
  return fileCoverage;
}

function recordCoverageFromScript({
  coverageByFile,
  compiledLabel,
  generatedLineHits,
  sourceMapMeta,
  repoRoot,
}) {
  if (!sourceMapMeta?.sourceMap || !sourceMapMeta.sourceMapLines) {
    return false;
  }

  const sourceMap = sourceMapMeta.sourceMap;
  let wroteCoverage = false;

  for (
    let lineIndex = 0;
    lineIndex < sourceMapMeta.sourceMapLines.length;
    lineIndex += 1
  ) {
    const segments = sourceMapMeta.sourceMapLines[lineIndex];
    const generatedLine = lineIndex + 1;
    const hitCount = generatedLineHits.get(generatedLine) ?? 0;

    for (const segment of segments) {
      if (
        typeof segment.sourceIndex !== "number" ||
        typeof segment.originalLine !== "number"
      ) {
        continue;
      }
      const sourcePath = sourceMap.sources?.[segment.sourceIndex];
      const resolvedPath = resolveSourcePath({
        repoRoot,
        compiledRepoPath: sourceMapMeta.compiledRepoPath,
        sourceRoot: sourceMapMeta.sourceRoot ?? sourceMap.sourceRoot,
        sourcePath,
      });
      if (!resolvedPath) {
        continue;
      }

      const fileCoverage = ensureFileCoverage(coverageByFile, resolvedPath);
      const originalLine = segment.originalLine + 1;
      fileCoverage.executableLines.add(originalLine);
      fileCoverage.generatedSources.add(compiledLabel);
      if (hitCount > 0) {
        const nextValue = Math.max(
          fileCoverage.coveredLines.get(originalLine) ?? 0,
          hitCount,
        );
        fileCoverage.coveredLines.set(originalLine, nextValue);
        wroteCoverage = true;
      }
    }
  }

  return wroteCoverage;
}

async function loadNodeCoverage(rawDir) {
  const files = (await walkFiles(rawDir)).filter((filePath) =>
    filePath.endsWith(".json"),
  );
  const payloads = [];
  for (const filePath of files) {
    payloads.push({
      filePath,
      payload: JSON.parse(await readFile(filePath, "utf8")),
    });
  }
  return payloads;
}

async function loadChromiumCoverage(rawDir) {
  const files = (await walkFiles(rawDir)).filter((filePath) =>
    filePath.endsWith(".json"),
  );
  const payloads = [];
  for (const filePath of files) {
    payloads.push({
      filePath,
      payload: JSON.parse(await readFile(filePath, "utf8")),
    });
  }
  return payloads;
}

function toSummaryMetric(covered, total) {
  return {
    covered,
    total,
    pct: total === 0 ? 0 : Number(((covered / total) * 100).toFixed(2)),
  };
}

function renderHtml(summary, meta) {
  const rows = summary.files
    .map(
      (file) => `
        <tr>
          <td><code>${file.path}</code></td>
          <td>${file.lines.covered}/${file.lines.total}</td>
          <td>${file.lines.pct.toFixed(2)}%</td>
          <td><code>${file.uncoveredLines.slice(0, 10).join(", ") || "-"}</code></td>
        </tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Nexu Desktop E2E Coverage</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 24px; color: #111827; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; vertical-align: top; }
      th { background: #f3f4f6; }
      code { font-family: ui-monospace, monospace; font-size: 12px; }
    </style>
  </head>
  <body>
    <h1>Nexu Desktop E2E Coverage</h1>
    <p>Run <code>${meta.workflowRunId ?? "unknown"}</code> · mode <code>${meta.mode ?? "unknown"}</code> · source <code>${meta.source ?? "unknown"}</code></p>
    <p>Coverage kind: <code>${summary.kind}</code> · Path normalization v${meta.pathNormalizationVersion}</p>
    <h2>Total</h2>
    <p><strong>${summary.total.lines.covered}/${summary.total.lines.total}</strong> executable source lines covered (${summary.total.lines.pct.toFixed(2)}%).</p>
    <h2>Files</h2>
    <table>
      <thead>
        <tr>
          <th>File</th>
          <th>Covered lines</th>
          <th>Percent</th>
          <th>First uncovered lines</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </body>
</html>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const coverageDir = path.join(args.captureDir, "coverage");
  const rawDir = path.join(coverageDir, "raw");
  const nodeRawDir = path.join(rawDir, "node-v8");
  const chromiumRawDir = path.join(rawDir, "chromium");
  const htmlDir = path.join(coverageDir, "html");

  await mkdir(coverageDir, { recursive: true });
  await mkdir(htmlDir, { recursive: true });

  const runContext =
    (await readJsonIfExists(path.join(rawDir, "run-context.json"))) ?? {};
  const buildManifest =
    (await readJsonIfExists(
      path.join(args.artifactsDir, "coverage-build-manifest.json"),
    )) ?? {};
  const artifactSourceMaps = await buildArtifactSourceMapsIndex({
    artifactsDir: args.artifactsDir,
    repoRoot: args.repoRoot,
  });

  const coverageByFile = new Map();
  const includedTargets = [];
  const includedProcesses = [];

  const nodePayloads = await loadNodeCoverage(nodeRawDir);
  for (const { filePath, payload } of nodePayloads) {
    const scripts = Array.isArray(payload?.result) ? payload.result : [];
    const relativeArtifactPath = toPosixPath(path.relative(rawDir, filePath));
    includedProcesses.push(relativeArtifactPath);
    for (const script of scripts) {
      const sourceMapMeta = getNodeSourceMapEntry(
        payload,
        script.url,
        args.repoRoot,
      );
      if (!sourceMapMeta?.lineLengths) {
        continue;
      }
      const generatedLineHits = offsetsToLineCoverage(
        sourceMapMeta.lineLengths,
        flattenRanges(script.functions),
      );
      recordCoverageFromScript({
        coverageByFile,
        compiledLabel: script.url,
        generatedLineHits,
        sourceMapMeta,
        repoRoot: args.repoRoot,
      });
    }
  }

  const chromiumPayloads = await loadChromiumCoverage(chromiumRawDir);
  for (const { filePath, payload } of chromiumPayloads) {
    const relativeArtifactPath = toPosixPath(path.relative(rawDir, filePath));
    includedTargets.push({
      artifact: relativeArtifactPath,
      targetId: payload.targetId ?? null,
      targetType: payload.targetType ?? null,
      scenarioName: payload.scenarioName ?? null,
      url: payload.url ?? null,
    });
    for (const script of Array.isArray(payload?.result) ? payload.result : []) {
      const sourceMapMeta = pickArtifactSourceMap(
        script.url,
        artifactSourceMaps,
      );
      if (!sourceMapMeta?.lineLengths) {
        continue;
      }
      const generatedLineHits = offsetsToLineCoverage(
        sourceMapMeta.lineLengths,
        flattenRanges(script.functions),
      );
      recordCoverageFromScript({
        coverageByFile,
        compiledLabel: script.url,
        generatedLineHits,
        sourceMapMeta,
        repoRoot: args.repoRoot,
      });
    }
  }

  const files = [...coverageByFile.values()]
    .map((entry) => {
      const executableLines = [...entry.executableLines].sort(
        (left, right) => left - right,
      );
      const coveredLines = Object.fromEntries(
        [...entry.coveredLines.entries()]
          .sort((left, right) => left[0] - right[0])
          .map(([line, count]) => [String(line), count]),
      );
      const uncoveredLines = executableLines.filter(
        (line) => !(line in coveredLines),
      );
      return {
        path: entry.path,
        generatedSources: [...entry.generatedSources].sort(),
        executableLines,
        coveredLines,
        uncoveredLines,
        lines: toSummaryMetric(
          Object.keys(coveredLines).length,
          executableLines.length,
        ),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));

  if (files.length === 0) {
    throw new Error(
      "No first-party coverage files were produced after remapping raw node-v8/chromium coverage",
    );
  }

  const totalLinesCovered = files.reduce(
    (sum, file) => sum + file.lines.covered,
    0,
  );
  const totalLines = files.reduce((sum, file) => sum + file.lines.total, 0);

  const summary = {
    kind: "line-derived",
    generatedAt: new Date().toISOString(),
    total: {
      lines: toSummaryMetric(totalLinesCovered, totalLines),
    },
    files,
    topUncoveredFiles: [...files]
      .sort(
        (left, right) =>
          right.uncoveredLines.length - left.uncoveredLines.length,
      )
      .slice(0, 10)
      .map((file) => ({
        path: file.path,
        uncoveredLineCount: file.uncoveredLines.length,
      })),
  };

  const meta = {
    gitSha:
      runContext.gitSha ??
      buildManifest.gitSha ??
      process.env.GITHUB_SHA ??
      null,
    workflowRunId:
      runContext.workflowRunId ??
      buildManifest.workflowRunId ??
      process.env.GITHUB_RUN_ID ??
      null,
    mode: runContext.mode ?? buildManifest.mode ?? process.env.MODE ?? null,
    source:
      runContext.source ??
      buildManifest.source ??
      process.env.NEXU_DESKTOP_E2E_SOURCE ??
      null,
    coverageEnabled: runContext.coverageEnabled ?? true,
    coverageRunId:
      runContext.coverageRunId ??
      process.env.NEXU_DESKTOP_E2E_COVERAGE_RUN_ID ??
      null,
    startedAt: runContext.startedAt ?? null,
    finishedAt: new Date().toISOString(),
    includedTargets,
    includedProcesses,
    pathNormalizationVersion:
      buildManifest.pathNormalizationVersion ??
      runContext.pathNormalizationVersion ??
      DEFAULT_PATH_NORMALIZATION_VERSION,
  };

  const coverageFinal = {
    schemaVersion: 1,
    kind: "line-derived",
    generatedAt: summary.generatedAt,
    files: Object.fromEntries(
      files.map((file) => [
        file.path,
        {
          path: file.path,
          generatedSources: file.generatedSources,
          executableLines: file.executableLines,
          coveredLines: file.coveredLines,
        },
      ]),
    ),
  };

  const lcovInfo = files
    .map((file) => {
      const daLines = file.executableLines
        .map(
          (lineNumber) =>
            `DA:${lineNumber},${file.coveredLines[String(lineNumber)] ?? 0}`,
        )
        .join("\n");
      return [
        "TN:",
        `SF:${file.path}`,
        daLines,
        `LF:${file.lines.total}`,
        `LH:${file.lines.covered}`,
        "end_of_record",
      ].join("\n");
    })
    .join("\n");

  await writeFile(
    path.join(coverageDir, "coverage-final.json"),
    `${JSON.stringify(coverageFinal, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(coverageDir, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(coverageDir, "meta.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
    "utf8",
  );
  await writeFile(path.join(coverageDir, "lcov.info"), `${lcovInfo}\n`, "utf8");
  await writeFile(
    path.join(htmlDir, "index.html"),
    renderHtml(summary, meta),
    "utf8",
  );

  log(`Merged coverage for ${files.length} file(s)`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
