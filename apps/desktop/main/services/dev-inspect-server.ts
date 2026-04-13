import {
  type IncomingMessage,
  type ServerResponse,
  createServer,
} from "node:http";
import { BrowserWindow, app } from "electron";
import type {
  DesktopDevDomSnapshotResult,
  DesktopDevEvalResult,
  DesktopDevRendererLogSnapshot,
  DesktopDevScreenshotResult,
} from "../../shared/host";
import {
  captureDesktopDevDomSnapshot,
  captureDesktopDevScreenshot,
  evaluateDesktopDevScript,
  getDesktopDevRendererLogSnapshot,
} from "../ipc";

type DesktopDevInspectServerOptions = {
  host: string;
  port: number;
  token: string;
};

type DesktopDevInspectResponse =
  | DesktopDevScreenshotResult
  | DesktopDevEvalResult
  | DesktopDevDomSnapshotResult
  | DesktopDevRendererLogSnapshot;

let desktopDevInspectServer: ReturnType<typeof createServer> | null = null;

function getDesktopDevTargetContents(): Electron.WebContents {
  const targetWindow = BrowserWindow.getAllWindows().find(
    (window) => !window.isDestroyed(),
  );

  if (!targetWindow) {
    throw new Error("No desktop renderer window is available.");
  }

  return targetWindow.webContents;
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: DesktopDevInspectResponse | { error: string },
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function readLimitFromUrl(request: IncomingMessage): number | undefined {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  const rawLimit = requestUrl.searchParams.get("limit");

  if (!rawLimit) {
    return undefined;
  }

  const limit = Number.parseInt(rawLimit, 10);
  return Number.isInteger(limit) && limit > 0 ? limit : undefined;
}

async function handleDesktopDevInspectRequest(
  request: IncomingMessage,
): Promise<DesktopDevInspectResponse> {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  const contents = getDesktopDevTargetContents();

  if (request.method === "POST" && requestUrl.pathname === "/screenshot") {
    return captureDesktopDevScreenshot(contents);
  }

  if (request.method === "POST" && requestUrl.pathname === "/eval") {
    const body = JSON.parse(await readRequestBody(request)) as {
      script?: string;
    };

    if (!body.script) {
      throw new Error("Missing eval script.");
    }

    return evaluateDesktopDevScript(contents, body.script);
  }

  if (request.method === "POST" && requestUrl.pathname === "/dom") {
    const rawBody = await readRequestBody(request);
    const body =
      rawBody.length > 0
        ? (JSON.parse(rawBody) as { maxHtmlLength?: number })
        : {};

    return captureDesktopDevDomSnapshot(contents, body.maxHtmlLength);
  }

  if (request.method === "GET" && requestUrl.pathname === "/logs") {
    return getDesktopDevRendererLogSnapshot(readLimitFromUrl(request));
  }

  throw new Error(
    `Unsupported desktop dev inspect route: ${request.method ?? "GET"} ${requestUrl.pathname}`,
  );
}

export async function startDesktopDevInspectServer(
  options: DesktopDevInspectServerOptions,
): Promise<void> {
  if (app.isPackaged || desktopDevInspectServer) {
    return;
  }

  desktopDevInspectServer = createServer(async (request, response) => {
    if (request.headers["x-nexu-dev-inspect-token"] !== options.token) {
      writeJson(response, 401, {
        error: "Unauthorized desktop dev inspect request.",
      });
      return;
    }

    try {
      const result = await handleDesktopDevInspectRequest(request);
      writeJson(response, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeJson(response, 400, { error: message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    desktopDevInspectServer?.once("error", reject);
    desktopDevInspectServer?.listen(options.port, options.host, () => {
      desktopDevInspectServer?.off("error", reject);
      resolve();
    });
  });
}

export async function stopDesktopDevInspectServer(): Promise<void> {
  if (!desktopDevInspectServer) {
    return;
  }

  const server = desktopDevInspectServer;
  desktopDevInspectServer = null;

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
