export const supportedDevCommandList = [
  "start",
  "restart",
  "stop",
  "status",
  "logs",
  "help",
] as const;

export type DevCommand = (typeof supportedDevCommandList)[number];

const supportedDevCommands = new Set<string>(supportedDevCommandList);

export function isSupportedDevCommand(command: string): boolean {
  return supportedDevCommands.has(command);
}

export const supportedDevTargetList = [
  "desktop",
  "openclaw",
  "controller",
  "web",
] as const;

export type DevTarget = (typeof supportedDevTargetList)[number];

const supportedDevTargets = new Set<string>(supportedDevTargetList);

export function isSupportedDevTarget(target: string): boolean {
  return supportedDevTargets.has(target);
}
