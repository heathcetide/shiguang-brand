import { z } from "zod";

export const apiErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.unknown().optional(),
  requestId: z.string().optional(),
}).strict();

export type ApiErrorResponse = z.infer<typeof apiErrorSchema>;

export const cursorPageMetadataSchema = z.object({
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative().optional(),
}).strict();

export type CursorPageMetadata = z.infer<typeof cursorPageMetadataSchema>;

export const authErrorCodes = [
  "AUTH_REQUIRED",
  "AUTH_INVALID",
  "AUTH_EXPIRED",
  "AUTH_FORBIDDEN",
] as const;

export const authErrorCodeSchema = z.enum(authErrorCodes);
export type AuthErrorCode = z.infer<typeof authErrorCodeSchema>;
