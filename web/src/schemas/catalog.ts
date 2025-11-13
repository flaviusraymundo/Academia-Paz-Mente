import { z } from "zod";

export const CourseSchema = z.object({
  id: z.string(),
  slug: z.string().optional(),
  title: z.string(),
  summary: z.string().optional(),
  level: z.string().optional(),
  active: z.boolean().optional(),
  module_count: z.number().optional(),
  item_count: z.number().optional(),
});

export const TrackCourseRelSchema = z.object({
  courseId: z.string(),
  order: z.number(),
  required: z.boolean(),
});

export const TrackSchema = z.object({
  id: z.string(),
  slug: z.string().optional(),
  title: z.string(),
  active: z.boolean().optional(),
  courses: z.array(TrackCourseRelSchema),
});

export const CatalogSchema = z.object({
  courses: z.array(CourseSchema).optional(),
  tracks: z.array(TrackSchema).optional(),
});

export type CatalogData = z.infer<typeof CatalogSchema>;
