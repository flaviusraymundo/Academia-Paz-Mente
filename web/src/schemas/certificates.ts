import { z } from "zod";

export const CertificateSchema = z
  .object({
    id: z.string().optional(),
    courseId: z.string().optional(),
    serial: z.string(),
    issuedAt: z.string().optional(),
    status: z.string().optional(),
    url: z.string().url().optional(),
  })
  .passthrough();

export const CertificateListSchema = z
  .object({
    certificates: z.array(CertificateSchema).default([]),
  })
  .passthrough();

export const CertificateVerifySchema = z
  .object({
    serial: z.string(),
    valid: z.boolean(),
    courseId: z.string().optional(),
    issuedAt: z.string().optional(),
    owner: z.any().optional(),
  })
  .passthrough();

export type Certificate = z.infer<typeof CertificateSchema>;
export type CertificateList = z.infer<typeof CertificateListSchema>;
export type CertificateVerify = z.infer<typeof CertificateVerifySchema>;
