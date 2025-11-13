import { z } from "zod";

export const PlaybackTokenResponseSchema = z.object({
  token: z.string().nullable().optional(),
}).passthrough();

export type PlaybackTokenResponse = z.infer<typeof PlaybackTokenResponseSchema>;
