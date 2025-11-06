// src/server/lib/certificates.ts
import type { PoolClient } from "pg";
import { ulid } from "ulid";
import crypto from "crypto";

export type IssueArgs = {
  userId: string;
  courseId: string;
  fullName?: string | null;
  assetUrl?: string | null; // opcional: se já vier pronto (ex.: PDF no R2)
  reissue?: boolean; // se true, força atualizar asset_url; decide issued_at abaixo
  keepIssuedAt?: boolean; // se true, preserva issued_at original numa reemissão
};

function computeHash(userId: string, courseId: string, issuedAtISO: string): string {
  return crypto.createHash("sha256").update(`${userId}|${courseId}|${issuedAtISO}`).digest("hex");
}

export async function issueCertificate(
  client: PoolClient,
  args: IssueArgs
): Promise<{ certificateUrl: string; serial: string }> {
  const { userId, courseId, fullName = null, assetUrl = null, reissue = false, keepIssuedAt = false } = args;

  // Se não veio assetUrl, use um placeholder determinístico (você pode trocar para URL do R2 quando plugar o render)
  // Obs.: usamos ULID como parte do path para não colidir em múltiplas emissões
  const serial = ulid();
  const url = assetUrl ?? `https://lifeflourishconsulting.com/certificates/${userId}/${courseId}/${serial}.pdf`;

  if (reissue) {
    if (keepIssuedAt) {
      // Reemissão mantendo issued_at original
      const { rows } = await client.query<{ issued_at: string }>(
        `select issued_at from certificate_issues where user_id=$1 and course_id=$2 limit 1`,
        [userId, courseId]
      );
      const issuedAtISO = rows[0]?.issued_at ?? new Date().toISOString();
      const serialHash = computeHash(userId, courseId, new Date(issuedAtISO).toISOString());
      await client.query(
        `
        insert into certificate_issues(id, user_id, course_id, asset_url, issued_at, full_name, serial, serial_hash)
        values (gen_random_uuid(), $1, $2, $3, $4::timestamptz, $5, $6, $7)
        on conflict (user_id, course_id) do update
          set asset_url   = excluded.asset_url,
              full_name   = coalesce(excluded.full_name, certificate_issues.full_name),
              serial      = excluded.serial,
              serial_hash = excluded.serial_hash
        `,
        [userId, courseId, url, issuedAtISO, fullName, serial, serialHash]
      );
      return { certificateUrl: url, serial };
    } else {
      // Reemissão com novo issued_at (atualiza a data)
      const issuedAtISO = new Date().toISOString();
      const serialHash = computeHash(userId, courseId, issuedAtISO);
      await client.query(
        `
        insert into certificate_issues(id, user_id, course_id, asset_url, issued_at, full_name, serial, serial_hash)
        values (gen_random_uuid(), $1, $2, $3, $4::timestamptz, $5, $6, $7)
        on conflict (user_id, course_id) do update
          set asset_url   = excluded.asset_url,
              issued_at   = excluded.issued_at,
              full_name   = coalesce(excluded.full_name, certificate_issues.full_name),
              serial      = excluded.serial,
              serial_hash = excluded.serial_hash
        `,
        [userId, courseId, url, issuedAtISO, fullName, serial, serialHash]
      );
      return { certificateUrl: url, serial };
    }
  }

  // Primeira emissão (ou idempotência): grava se não existe; se existir, mantém issued_at antigo
  const issuedAtISO = new Date().toISOString();
  const serialHash = computeHash(userId, courseId, issuedAtISO);
  const { rows } = await client.query<{ certificate_url: string; serial: string }>(
    `
    insert into certificate_issues(id, user_id, course_id, asset_url, issued_at, full_name, serial, serial_hash)
    values (gen_random_uuid(), $1, $2, $3, $4::timestamptz, $5, $6, $7)
    on conflict (user_id, course_id) do update
      set asset_url   = excluded.asset_url,
          full_name   = coalesce(excluded.full_name, certificate_issues.full_name)
      returning asset_url as certificate_url, serial
    `,
    [userId, courseId, url, issuedAtISO, fullName, serial, serialHash]
  );
  const row = rows[0];
  if (!row) {
    throw new Error("certificate_issue_upsert_failed");
  }
  return { certificateUrl: row.certificate_url, serial: row.serial ?? serial };
}
