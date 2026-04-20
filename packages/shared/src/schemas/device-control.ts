import { z } from "zod";

// ─── Primitives ───────────────────────────────────────────────────────────────

export const deviceCapabilitiesSchema = z.object({
  model: z.string().optional(),
  osVersion: z.union([z.number(), z.string()]).optional(),
  screenWidth: z.number().optional(),
  screenHeight: z.number().optional(),
  manufacturer: z.string().optional(),
  currentApp: z.string().optional(),
  batteryLevel: z.number().optional(),
  batteryStatus: z.string().optional(),
  totalRam: z.number().optional(),
  availableRam: z.number().optional(),
  totalStorage: z.number().optional(),
  availableStorage: z.number().optional(),
  wifiSsid: z.string().optional(),
  isWifiConnected: z.boolean().optional(),
  isCharging: z.boolean().optional(),
});

export const deviceStatusSchema = z.enum(["idle", "busy", "error"]);

export const deviceInfoSchema = z.object({
  deviceId: z.string().min(1),
  model: z.string().optional(),
  osVersion: z.union([z.number(), z.string()]).optional(),
  screenWidth: z.number().optional(),
  screenHeight: z.number().optional(),
  status: deviceStatusSchema,
  currentApp: z.string().optional(),
  currentTaskId: z.string().min(1).optional(),
  connectedAt: z.number().int().positive(),
  lastSeen: z.number().int().positive(),
  manufacturer: z.string().optional(),
  batteryLevel: z.number().optional(),
  batteryStatus: z.string().optional(),
  totalRam: z.union([z.number(), z.string()]).optional(),
  availableRam: z.union([z.number(), z.string()]).optional(),
  totalStorage: z.union([z.number(), z.string()]).optional(),
  availableStorage: z.union([z.number(), z.string()]).optional(),
  wifiSsid: z.string().optional(),
  isWifiConnected: z.boolean().optional(),
  isCharging: z.boolean().optional(),
});

export const deviceListResponseSchema = z.object({
  devices: z.array(deviceInfoSchema),
});

export const deviceExecuteTaskBodySchema = z.object({
  task: z.string().min(1),
  maxSteps: z.number().int().min(1).max(100).optional().default(30),
  guidance: z.string().optional(),
  sessionId: z.string().optional(),
  allowedActions: z.array(z.string()).optional(),
  allowedApps: z.array(z.string()).optional(),
  timeout: z.number().int().positive().optional().default(120000),
});

export const stepRecordSchema = z.object({
  step: z.number().int().min(1),
  action: z.string(),
  target: z.string().optional(),
  success: z.boolean(),
  error: z.string().optional(),
});

export const taskResultSchema = z.object({
  taskId: z.string().min(1),
  success: z.boolean(),
  message: z.string().optional(),
  totalSteps: z.number().int().min(0).optional(),
  steps: z.array(stepRecordSchema).optional(),
  failedAtStep: z.number().int().min(1).optional(),
  finalScreenshot: z.string().optional(),
  duration: z.number().int().nonnegative().optional(),
});

export const deviceExecuteTaskResponseSchema = z.object({
  result: taskResultSchema,
});

export const cancelTaskBodySchema = z.object({
  taskId: z.string().min(1),
});

export const cancelTaskResponseSchema = z.object({
  cancelled: z.boolean(),
  message: z.string().optional(),
});

export const deviceErrorCodeSchema = z.enum([
  "DEVICE_OFFLINE",
  "PERMISSION_DENIED",
  "TIMEOUT",
  "INVALID_PARAMS",
  "SHELL_DENIED",
  "OPERATION_FAILED",
  "DEVICE_NOT_FOUND",
  "TASK_NOT_FOUND",
  "TASK_ALREADY_RUNNING",
  "MAX_DEVICES_REACHED",
]);

export type DeviceCapabilities = z.infer<typeof deviceCapabilitiesSchema>;
export type DeviceStatus = z.infer<typeof deviceStatusSchema>;
export type DeviceInfo = z.infer<typeof deviceInfoSchema>;
export type DeviceListResponse = z.infer<typeof deviceListResponseSchema>;
export type DeviceExecuteTaskBody = z.infer<typeof deviceExecuteTaskBodySchema>;
export type StepRecord = z.infer<typeof stepRecordSchema>;
export type TaskResult = z.infer<typeof taskResultSchema>;
export type CancelTaskBody = z.infer<typeof cancelTaskBodySchema>;
export type DeviceErrorCode = z.infer<typeof deviceErrorCodeSchema>;
