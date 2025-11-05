import { z } from "zod";
import type { Request, Response, NextFunction } from "express";

export const validateQuery = (schema: z.ZodTypeAny) =>
  (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          formErrors: parsed.error.formErrors.formErrors ?? [],
          fieldErrors: parsed.error.formErrors.fieldErrors ?? {},
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
