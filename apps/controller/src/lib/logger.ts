type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function getLevel(): LogLevel {
  const value = process.env.LOG_LEVEL;
  if (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error"
  ) {
    return value;
  }

  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[getLevel()];
}

function write(
  level: LogLevel,
  message: string,
  details?: Record<string, unknown>,
): void {
  if (!shouldLog(level)) {
    return;
  }

  const payload = {
    level,
    service: "nexu-controller",
    time: new Date().toISOString(),
    message,
    ...(details ?? {}),
  };

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}

export const logger = {
  debug(details: Record<string, unknown>, message: string): void {
    write("debug", message, details);
  },
  info(details: Record<string, unknown>, message: string): void {
    write("info", message, details);
  },
  warn(details: Record<string, unknown>, message: string): void {
    write("warn", message, details);
  },
  error(details: Record<string, unknown>, message: string): void {
    write("error", message, details);
  },
};
