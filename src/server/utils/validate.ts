import { z } from "zod";
import type { Request, Response, NextFunction } from "express";

export const validateQuery = (schema: z.ZodObject<any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      return res.status(400).json({
        error: {
          formErrors: flat.formErrors ?? [],
          fieldErrors: flat.fieldErrors ?? {},
        },
      });
    }

    (req as any).query = parsed.data;
    return next();
  };

export const qCourseId = z.object({
  courseId: z.string().uuid(),
});

export const qCourseIdOptional = z.object({
  courseId: z.string().uuid().optional(),
});
