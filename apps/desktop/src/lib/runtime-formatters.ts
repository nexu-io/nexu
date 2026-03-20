import type {
  RuntimeLogEntry,
  RuntimeUnitPhase,
  RuntimeUnitState,
} from "../../shared/host";

export type LogFilter = "all" | "errors" | "lifecycle";

export function maskSentryDsn(dsn: string | null | undefined): string {
  if (!dsn) {
    return "missing";
  }

  const match = dsn.match(/^(https?:\/\/)([^@]+)@(.+)$/);

  if (!match) {
    return "configured";
  }

  const [, protocol, publicKey, hostAndPath] = match;
  const visibleKey = publicKey.slice(-6);
  const maskedKey = `${"*".repeat(Math.max(publicKey.length - 6, 3))}${visibleKey}`;

  return `${protocol}${maskedKey}@${hostAndPath}`;
}

export function formatBuildTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "(unknown)";
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const timezoneOffsetMinutes = -date.getTimezoneOffset();
  const offsetSign = timezoneOffsetMinutes >= 0 ? "+" : "-";
  const offsetHours = String(
    Math.floor(Math.abs(timezoneOffsetMinutes) / 60),
  ).padStart(2, "0");
  const offsetMinutes = String(Math.abs(timezoneOffsetMinutes) % 60).padStart(
    2,
    "0",
  );

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetSign}${offsetHours}:${offsetMinutes}`;
}

export function formatBuildCommit(value: string | null | undefined): string {
  if (!value) {
    return "(unknown)";
  }

  return value.slice(0, 7);
}

export function phaseTone(phase: RuntimeUnitPhase): string {
  switch (phase) {
    case "running":
      return "is-running";
    case "failed":
      return "is-failed";
    case "starting":
    case "stopping":
      return "is-busy";
    default:
      return "is-idle";
  }
}

export function kindLabel(unit: RuntimeUnitState): string {
  return `${unit.kind} / ${unit.launchStrategy}`;
}

export function formatLogLine(entry: RuntimeLogEntry): string {
  const actionLabel = entry.actionId ? ` [action=${entry.actionId}]` : "";
  return `#${entry.cursor} ${entry.ts} [${entry.stream}] [${entry.kind}] [reason=${entry.reasonCode}]${actionLabel} ${entry.message}`;
}

export function logFilterLabel(filter: LogFilter): string {
  switch (filter) {
    case "errors":
      return "Errors";
    case "lifecycle":
      return "Lifecycle";
    default:
      return "All";
  }
}
