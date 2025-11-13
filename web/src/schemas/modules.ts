import { z } from "zod";

export const ItemSchema = z.object({
  item_id: z.string(),
  type: z.enum(["video", "text", "quiz"]),
  order: z.number(),
  payload_ref: z.any().optional(),
});

export const ModuleSchema = z.object({
  id: z.string(),
  title: z.string(),
  order: z.number(),
  unlocked: z.boolean(),
  itemCount: z.number().optional(),
  items: z.array(ItemSchema),
  progress: z
    .object({
      status: z.string(),
      score: z.number().optional(),
      timeSpentSecs: z.number().optional(),
    })
    .optional(),
});

export const ModuleItemsResponseSchema = z.object({
  // Aceita undefined ou null (compatibilidade com respostas antigas { items: null })
  items: z.array(ModuleSchema).nullish(),
});

export type ModuleData = z.infer<typeof ModuleSchema>;
export type ModuleItemsData = z.infer<typeof ModuleItemsResponseSchema>;
