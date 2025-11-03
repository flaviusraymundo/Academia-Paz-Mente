// src/server/lib/idempotency.ts
import type { PoolClient } from "pg";

export async function beginIdempotent(
  client: PoolClient,
  key: string,
  scope: string
): Promise<"new" | "exists"> {
  const res = await client.query(
    `insert into idempotency_keys(key, scope, status)
     values ($1,$2,'processing')
     on conflict (key) do nothing`,
    [key, scope]
  );
  return res.rowCount === 1 ? "new" : "exists";
}

export async function finishIdempotent(
  client: PoolClient,
  key: string,
  status: "succeeded" | "failed",
  responseHash?: string
) {
  await client.query(
    `update idempotency_keys set status=$2, response_hash=$3, updated_at=now() where key=$1`,
    [key, status, responseHash ?? null]
  );
}
