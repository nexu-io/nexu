import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { globalShortcut, BrowserWindow } from "electron";
import type { GlobalShortcutConfig } from "../../shared/host";

/**
 * Default global shortcut accelerator to open/focus nexu.
 * Uses CommandOrControl for cross-platform compatibility:
 * - macOS: Cmd+Shift+N
 * - Windows/Linux: Ctrl+Shift+N
 */
export const DEFAULT_GLOBAL_SHORTCUT = "CommandOrControl+Shift+N";

/**
 * Default configuration: enabled with default accelerator.
 */
export const DEFAULT_SHORTCUT_CONFIG: GlobalShortcutConfig = {
  enabled: true,
  accelerator: DEFAULT_GLOBAL_SHORTCUT,
};

/**
 * Manages global keyboard shortcuts for the nexu desktop app.
 * 
 * Responsibilities:
 * - Register/unregister global shortcuts
 * - Load/save shortcut preferences from userData
 * - Handle shortcut callback to show/focus/create window
 */
export class GlobalShortcutManager {
  private configPath: string;
  private config: GlobalShortcutConfig;
  private mainWindowGetter: () => BrowserWindow | null;
  private mainWindowCreator: () => BrowserWindow;
  private registeredAccelerator: string | null = null;

  constructor(
    userDataPath: string,
    mainWindowGetter: () => BrowserWindow | null,
    mainWindowCreator: () => BrowserWindow,
  ) {
    this.configPath = resolve(userDataPath, "preferences", "shortcut.json");
    this.mainWindowGetter = mainWindowGetter;
    this.mainWindowCreator = mainWindowCreator;
    this.config = this.loadConfig();
  }

  /**
   * Load shortcut configuration from disk, or return defaults if not found.
   */
  private loadConfig(): GlobalShortcutConfig {
    try {
      if (!existsSync(this.configPath)) {
        return DEFAULT_SHORTCUT_CONFIG;
      }

      const content = readFileSync(this.configPath, "utf8");
      const parsed = JSON.parse(content) as unknown;

      if (!parsed || typeof parsed !== "object") {
        return DEFAULT_SHORTCUT_CONFIG;
      }

      const record = parsed as Record<string, unknown>;
      const enabled = typeof record.enabled === "boolean" ? record.enabled : true;
      const accelerator = typeof record.accelerator === "string" && record.accelerator.length > 0
        ? record.accelerator
        : DEFAULT_GLOBAL_SHORTCUT;

      return { enabled, accelerator };
    } catch {
      return DEFAULT_SHORTCUT_CONFIG;
    }
  }

  /**
   * Save shortcut configuration to disk.
   */
  private saveConfig(): void {
    try {
      const dir = join(this.configPath, "..");
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), "utf8");
    } catch (error) {
      console.error("[GlobalShortcutManager] Failed to save config:", error);
    }
  }

  /**
   * Handle the global shortcut being triggered.
   * Shows, focuses, or creates the main window.
   */
  private handleShortcut(): void {
    const mainWindow = this.mainWindowGetter();

    if (!mainWindow || mainWindow.isDestroyed()) {
      // Window doesn't exist, create a new one
      this.mainWindowCreator();
      return;
    }

    // Window exists, show and focus it
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.focus();
  }

  /**
   * Register the global shortcut if enabled.
   * Returns true if registration succeeded.
   */
  private registerShortcut(): boolean {
    if (!this.config.enabled) {
      return false;
    }

    // Unregister any existing shortcut first
    if (this.registeredAccelerator) {
      globalShortcut.unregister(this.registeredAccelerator);
      this.registeredAccelerator = null;
    }

    try {
      const success = globalShortcut.register(this.config.accelerator, () => {
        this.handleShortcut();
      });

      if (success) {
        this.registeredAccelerator = this.config.accelerator;
        console.log(`[GlobalShortcutManager] Registered global shortcut: ${this.config.accelerator}`);
        return true;
      } else {
        console.warn(`[GlobalShortcutManager] Failed to register shortcut: ${this.config.accelerator} (may be already registered by another app)`);
        return false;
      }
    } catch (error) {
      console.error(`[GlobalShortcutManager] Error registering shortcut: ${this.config.accelerator}`, error);
      return false;
    }
  }

  /**
   * Unregister the current global shortcut.
   */
  private unregisterShortcut(): void {
    if (this.registeredAccelerator) {
      globalShortcut.unregister(this.registeredAccelerator);
      console.log(`[GlobalShortcutManager] Unregistered global shortcut: ${this.registeredAccelerator}`);
      this.registeredAccelerator = null;
    }
  }

  /**
   * Start the manager: register the shortcut if enabled.
   */
  start(): void {
    if (this.config.enabled) {
      this.registerShortcut();
    }
  }

  /**
   * Stop the manager: unregister any active shortcut.
   */
  stop(): void {
    this.unregisterShortcut();
  }

  /**
   * Get the current shortcut configuration.
   */
  getConfig(): GlobalShortcutConfig {
    return { ...this.config };
  }

  /**
   * Set whether the global shortcut is enabled.
   * Returns true if the change was applied successfully.
   */
  setEnabled(enabled: boolean): boolean {
    const wasEnabled = this.config.enabled;
    this.config.enabled = enabled;
    this.saveConfig();

    if (enabled && !wasEnabled) {
      // Enable: register the shortcut
      return this.registerShortcut();
    } else if (!enabled && wasEnabled) {
      // Disable: unregister the shortcut
      this.unregisterShortcut();
    }

    return true;
  }

  /**
   * Set the accelerator for the global shortcut.
   * Returns true if the change was applied successfully.
   */
  setAccelerator(accelerator: string): boolean {
    // Validate accelerator is non-empty
    if (!accelerator || accelerator.trim().length === 0) {
      return false;
    }

    const oldAccelerator = this.config.accelerator;
    this.config.accelerator = accelerator.trim();
    this.saveConfig();

    // If shortcut is enabled, re-register with new accelerator
    if (this.config.enabled) {
      this.unregisterShortcut();
      return this.registerShortcut();
    }

    return true;
  }

  /**
   * Check if the shortcut is currently registered.
   */
  isRegistered(): boolean {
    return this.registeredAccelerator !== null;
  }

  /**
   * Check if a given accelerator is available for registration.
   */
  isAcceleratorAvailable(accelerator: string): boolean {
    return !globalShortcut.isRegistered(accelerator);
  }
}