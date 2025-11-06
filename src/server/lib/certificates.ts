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
}: IssueArgs): Promise<{ certificateUrl: string; serial: string }> {
  // Busca atual (se houver) para decidir preservação de issued_at
  const cur = await client.query(
    `select id, asset_url, full_name, serial, serial_hash, issued_at
       from certificate_issues
      where user_id=$1 and course_id=$2
      limit 1`,
    [userId, courseId]
  );

  const now = new Date();

  // Estratégia de serial/URL:
  // - Sem reissue: mantém serial/asset_url existentes; só atualiza se for 1ª emissão.
  // - Com reissue: gera novo serial; asset_url pode ser substituído.
  let serial: string;
  let serialHash: string;
  let finalUrl: string;

  if (cur.rowCount === 0) {
    // Primeira emissão
    serial = ulid();
    serialHash = sha256(serial);
    // URL default pode continuar por userId/courseId; se quiser por serial, mude aqui.
    finalUrl =
      assetUrl ||
      `https://lifeflourishconsulting.com/certificates/${userId}/${courseId}.pdf`;

    await client.query(
      `insert into certificate_issues
         (id, user_id, course_id, asset_url, issued_at, full_name, serial, serial_hash)
       values
         (gen_random_uuid(), $1, $2, $3, $4::timestamptz, $5, $6, $7)`,
      [userId, courseId, finalUrl, now.toISOString(), fullName, serial, serialHash]
    );
  } else {
    // Já existe certificado
    const row = cur.rows[0];
    if (reissue) {
      // Reemissão: novo serial; URL nova (ou a fornecida)
      serial = ulid();
      serialHash = sha256(serial);
      finalUrl =
        assetUrl ||
        `https://lifeflourishconsulting.com/certificates/${userId}/${courseId}.pdf`;
    } else {
      // Idempotente: preserva serial/hash/URL existentes
      serial = row.serial;
      serialHash = row.serial_hash;
      finalUrl = assetUrl || row.asset_url;
    }

    const issuedAtClause = keepIssuedAt
      ? "issued_at=certificate_issues.issued_at"
      : "issued_at=$8::timestamptz";

    await client.query(
      `update certificate_issues
          set asset_url=$3,
              full_name=$4,
              serial=$5,
              serial_hash=$6,
              ${issuedAtClause}
        where user_id=$1 and course_id=$2`,
      [userId, courseId, finalUrl, fullName, serial, serialHash, /*$7*/ null, now.toISOString()]
    );
  }

  // Log de analytics opcional (ignora erro caso não exista tabela/events)
  try {
    await client.query(
      `insert into events(id, kind, user_id, course_id, created_at)
       values (gen_random_uuid(), 'certificate_issued', $1, $2, now())`,
      [userId, courseId]
    );
  } catch {}

  return { certificateUrl: finalUrl, serial };
}
