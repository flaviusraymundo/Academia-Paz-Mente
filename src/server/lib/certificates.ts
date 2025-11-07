// src/server/lib/certificates.ts
import type { PoolClient } from "pg";
import { ulid } from "ulid";
import crypto from "crypto";

export type IssueArgs = {
  client: PoolClient;
  userId: string;
  courseId: string;
  fullName?: string | null;
  assetUrl?: string | null; // opcional: se já vier pronto (ex.: PDF no R2)
  reissue?: boolean; // se true, força atualizar asset_url; decide issued_at abaixo
  keepIssuedAt?: boolean; // se true, preserva issued_at original numa reemissão
};

export type CertificateIssueRow = {
  id: string;
  user_id: string;
  course_id: string;
  asset_url: string | null;
  issued_at: Date;
  full_name: string | null;
  serial: string | null;
  serial_hash: string | null;
};

export type CertificateIssueResult = {
  id: string;
  user_id: string;
  course_id: string;
  issued_at: Date;
  pdf_url: string | null;
  serial: string | null;
  hash: string | null;
  verifyUrl: string | null;
};

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function issueCertificate({
  client,
  userId,
  courseId,
  fullName = null,
  assetUrl = null,
  reissue = false,
  keepIssuedAt = false,
}: IssueArgs): Promise<CertificateIssueResult> {
  const current = await client.query<CertificateIssueRow>(
    `select id, user_id, course_id, asset_url, issued_at, full_name, serial, serial_hash
       from certificate_issues
      where user_id = $1 and course_id = $2
      limit 1`,
    [userId, courseId]
  );

  const existing = current.rows[0];
  const existingIssuedAt = existing?.issued_at ? new Date(existing.issued_at) : null;
  const now = new Date();
  const normalizedFullName = fullName ?? null;
  const shouldReissue = Boolean(reissue);
  const shouldKeepIssuedAt = Boolean(keepIssuedAt);

  const needsNewSerial =
    !existing || shouldReissue || !existing.serial || !existing.serial_hash;
  const serial = needsNewSerial ? ulid() : (existing.serial as string);
  const serialHash = needsNewSerial ? sha256(serial) : (existing.serial_hash as string);

  // Bases configuráveis
  const BASE =
    (process.env.APP_BASE_URL ||
      process.env.SITE_URL ||
      process.env.URL ||
      "https://lifeflourishconsulting.com").replace(/\/+$/, "");
  const ASSET_BASE =
    (process.env.CERT_ASSET_BASE || `${BASE}/certificates`).replace(/\/+$/, "");

  // URL final do PDF
  const fallbackUrl = `${ASSET_BASE}/${userId}/${courseId}.pdf`;
  const finalUrl = assetUrl || fallbackUrl;
  const finalAssetUrl =
    assetUrl ??
    (!existing
      ? fallbackUrl
      : shouldReissue
      ? fallbackUrl
      : existing.asset_url ?? fallbackUrl);

  const issuedAt = !existing
    ? now
    : shouldReissue
    ? shouldKeepIssuedAt
      ? existingIssuedAt ?? now
      : now
    : existingIssuedAt ?? now;

  const { rows } = await client.query<CertificateIssueRow>(
    `insert into certificate_issues(id, user_id, course_id, asset_url, issued_at, full_name, serial, serial_hash)
      values (gen_random_uuid(), $1, $2, $3, $4::timestamptz, $5, $6, $7)
      on conflict (user_id, course_id) do update
        set asset_url   = excluded.asset_url,
            issued_at   = CASE WHEN $8::boolean AND $9::boolean THEN certificate_issues.issued_at ELSE excluded.issued_at END,
            full_name   = COALESCE(excluded.full_name, certificate_issues.full_name),
            serial      = CASE WHEN $8::boolean THEN excluded.serial ELSE certificate_issues.serial END,
            serial_hash = CASE WHEN $8::boolean THEN excluded.serial_hash ELSE certificate_issues.serial_hash END
      returning id, user_id, course_id, asset_url, issued_at, full_name, serial, serial_hash`,
    [
      userId,
      courseId,
      finalAssetUrl,
      issuedAt.toISOString(),
      normalizedFullName,
      serial,
      serialHash,
      shouldReissue,
      shouldKeepIssuedAt,
    ]
  );

  const saved = rows[0];

  // Log de analytics opcional (ignora erro caso não exista tabela/events)
  try {
    await client.query(
      `insert into events(id, kind, user_id, course_id, created_at)
       values (gen_random_uuid(), 'certificate_issued', $1, $2, now())`,
      [userId, courseId]
    );
  } catch {}

  const rowOut: CertificateIssueResult = {
    id: saved.id,
    user_id: saved.user_id,
    course_id: saved.course_id,
    issued_at: saved.issued_at,
    pdf_url: finalUrl,
    serial: saved.serial ?? null,
    hash: saved.serial_hash ?? null,
    verifyUrl: saved.serial ? `${BASE}/api/certificates/verify/${saved.serial}` : null,
  };

  return rowOut;
}
