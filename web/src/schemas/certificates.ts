import { z } from "zod";

// Aceita tanto snake_case quanto camelCase e normaliza para a UI
export const CertificateRawSchema = z
  .object({
    id: z.string().optional(),
    course_id: z.string().optional(),
    courseId: z.string().optional(),
    serial: z.string().nullable().optional(),
    issued_at: z.string().optional(),
    issuedAt: z.string().optional(),
    pdf_url: z.string().url().optional(),
    url: z.string().url().optional(),
    status: z.string().optional(),
  })
  .passthrough()
  .transform((r) => ({
    id: r.id,
    courseId: r.courseId ?? r.course_id,
    serial: r.serial ?? null,
    issuedAt: r.issuedAt ?? r.issued_at,
    url: r.url ?? r.pdf_url,
    status: r.status,
  }));

export const CertificateListSchema = z
  .object({
    certificates: z.array(CertificateRawSchema).default([]),
  })
  .passthrough()
  .transform((d) => ({
    certificates: d.certificates,
  }));

// Verify: o endpoint retorna o próprio registro do certificado (sem "valid")
export const CertificateVerifyRawSchema = z
  .object({
    serial: z.string().nullable().optional(),
    course_id: z.string().optional(),
    issued_at: z.string().optional(),
    pdf_url: z.string().url().optional(),
    user_id: z.string().optional(),
    courseId: z.string().optional(),
    issuedAt: z.string().optional(),
    url: z.string().url().optional(),
  })
  .passthrough()
  .transform((r) => ({
    serial: r.serial ?? null,
    courseId: r.courseId ?? r.course_id,
    issuedAt: r.issuedAt ?? r.issued_at,
    url: r.url ?? r.pdf_url,
    userId: r.user_id,
  }));

export type Certificate = z.infer<typeof CertificateRawSchema>;
export type CertificateList = z.infer<typeof CertificateListSchema>;
export type CertificateVerify = z.infer<typeof CertificateVerifyRawSchema>;
