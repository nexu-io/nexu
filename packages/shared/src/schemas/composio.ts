import { z } from "zod";

export const composioExecuteRequestSchema = z.object({
  botId: z.string().min(1),
  action: z
    .string()
    .min(1)
    .regex(/^[A-Z][A-Z0-9_]+$/),
  params: z.record(z.unknown()).default({}),
});

export type ComposioExecuteRequest = z.infer<
  typeof composioExecuteRequestSchema
>;

export const composioExecuteResponseSchema = z.object({
  data: z.unknown().optional(),
  error: z.string().optional(),
  successful: z.boolean(),
});

export type ComposioExecuteResponse = z.infer<
  typeof composioExecuteResponseSchema
>;

export const composioDisconnectRequestSchema = z.object({
  botId: z.string().min(1),
  toolkitSlug: z.string().min(1),
});

export type ComposioDisconnectRequest = z.infer<
  typeof composioDisconnectRequestSchema
>;
