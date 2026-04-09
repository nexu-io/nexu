import type { DesktopUpdateCapability } from "../../shared/host";
import type {
  PlatformUpdateDriver,
  UpdateDriverCheckResult,
  UpdateDriverContext,
  UpdateDriverEventHandlers,
  UpdateDriverOptions,
} from "./update-driver";

export class UnsupportedUpdateDriver implements PlatformUpdateDriver {
  readonly capability: DesktopUpdateCapability;

  constructor(private readonly context: UpdateDriverContext) {
    this.capability = {
      platform: process.platform,
      check: false,
      downloadMode: "none",
      applyMode: "none",
      applyLabel: null,
      notes: `In-app desktop updates are not enabled for ${this.context.currentVersion} on ${process.platform}.`,
    };
  }

  getCurrentFeedUrl(): string {
    return `platform://${process.platform}/unsupported-update-flow`;
  }

  configure(_options: UpdateDriverOptions): void {}

  bindEvents(_handlers: UpdateDriverEventHandlers): void {}

  async checkForUpdates(): Promise<UpdateDriverCheckResult> {
    return { updateAvailable: false };
  }

  async downloadUpdate(): Promise<{ ok: boolean }> {
    return { ok: false };
  }

  async applyUpdate(): Promise<void> {}
}
