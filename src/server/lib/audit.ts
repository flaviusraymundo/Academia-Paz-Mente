import type { Pool, PoolClient } from "pg";

let ensured = false;

async function ensureTable(client: PoolClient) {
  if (ensured) return;
  await client.query(`
    create table if not exists audit_events (
      id uuid primary key default gen_random_uuid(),
      actor_email text,
      action text not null,
      entity_type text not null,
      entity_id uuid,
      payload_json jsonb,
      created_at timestamptz not null default now()
    );
  `);
  ensured = true;
}

/**
 * Garante a existência da tabela audit_events usando apenas o Pool.
 * Útil antes de leituras (ex.: GET /api/admin/audit) para ambientes sem eventos prévios.
 */
export async function ensureAuditTable(pool: Pool) {
  const client = await pool.connect();
  try {
    await ensureTable(client);
  } finally {
    client.release();
  }
}

export type AuditEvent = {
  actorEmail?: string | null;
  action: string;       // ex.: "courses.duplicate"
  entityType: string;   // ex.: "course" | "module" | "item" | "quiz" | "import"
  entityId?: string | null;
  payload?: any;
};

export async function logAudit(pool: Pool, ev: AuditEvent) {
  const client = await pool.connect();
  try {
    await ensureTable(client);
    await client.query(
      `insert into audit_events(actor_email, action, entity_type, entity_id, payload_json)
       values ($1, $2, $3, $4, $5::jsonb)`,
      [
        ev.actorEmail || null,
        ev.action,
        ev.entityType,
        ev.entityId || null,
        ev.payload ? JSON.stringify(ev.payload) : JSON.stringify({})
      ]
    );
  } finally {
    client.release();
  }
}