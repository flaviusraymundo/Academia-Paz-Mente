// src/server/routes/progress.ts
import { Router, Request, Response } from "express";
import { pool, withClient } from "../lib/db";
import { z } from "zod";
import { ulid } from "ulid";
import { requireAuth } from "../middleware/auth";
import { isUuid } from "../utils/ids";
import {
  getActiveEntitlements,
  hasActiveCourseEntitlement,
} from "../lib/entitlements";
import { issueCertificate } from "../lib/certificates";

const router = Router();

type ModuleRow = {
  module_id: string;
  title: string;
  order: number;
  status: string | null;
  score: number | null;
  time_spent_secs: number | null;
};

type ItemRow = {
  item_id: string;
  module_id: string;
  type: string;
  order: number;
  payload_ref: any;
};

type ModuleProgressRow = {
  module_id: string;
  status: string | null;
  score: number | null;
  time_spent_secs: number | null;
};

type ModuleStatusRow = {
  module_id: string;
  status: string | null;
};

async function meItemsHandler(req: Request, res: Response) {
  const userId = req.auth?.userId ?? req.user?.id ?? null;
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  const courseIdRaw = req.query?.courseId;
  const courseId = Array.isArray(courseIdRaw) ? courseIdRaw[0] : courseIdRaw;
  if (!courseId || !isUuid(String(courseId))) {
    return res.status(400).json({ error: "invalid_id", param: "courseId" });
  }

  const normalizedCourseId = String(courseId);

  if (process.env.ENTITLEMENTS_ENFORCE === "1") {
    const entitled = await withClient((client) =>
      hasActiveCourseEntitlement(client, userId, normalizedCourseId)
    );
    if (!entitled) {
      return res.status(403).json({ error: "no_entitlement" });
    }
  }

  try {
    if (process.env.ENTITLEMENTS_ENFORCE === "1") {
      const ok = await withClient((client) =>
        hasActiveCourseEntitlement(client, userId, normalizedCourseId)
      );
      if (!ok) {
        return res.status(403).json({ error: "no_entitlement" });
      }
    }

    const { rows: modules } = await pool.query<ModuleRow>(
      `
      select
        m.id as module_id,
        m.title,
        m."order",
        p.status,
        p.score,
        p.time_spent_secs
      from modules m
      left join progress p on p.module_id = m.id and p.user_id = $1
      where m.course_id = $2
      order by m."order" asc, m.id asc
      `,
      [userId, normalizedCourseId]
    );

    if (modules.length === 0) {
      return res.json({ items: [] });
    }

    const moduleIds = modules.map((m) => m.module_id);
    const { rows: rawItems } = await pool.query<ItemRow>(
      `
      select mi.id as item_id, mi.module_id, mi.type, mi."order", mi.payload_ref
      from module_items mi
      where mi.module_id = any($1::uuid[])
      order by mi.module_id asc, mi."order" asc
      `,
      [moduleIds]
    );

    const itemsByModule = new Map<string, ItemRow[]>();
    for (const item of rawItems) {
      const bucket = itemsByModule.get(item.module_id) ?? [];
      bucket.push(item);
      itemsByModule.set(item.module_id, bucket);
    }

    const items = modules
      .map((mod) => ({
        id: mod.module_id,
        title: mod.title,
        order: Number(mod.order),
        unlocked: false,
        itemCount: 0,
        items: (itemsByModule.get(mod.module_id) ?? []).map((it) => ({
          item_id: it.item_id,
          module_id: it.module_id,
          type: it.type,
          order: Number(it.order),
          payload_ref: it.payload_ref,
        })),
        progress: {
          status: mod.status ?? "not_started",
          score: Number(mod.score ?? 0),
          timeSpentSecs: Number(mod.time_spent_secs ?? 0),
        },
      }))
      .sort((a, b) => a.order - b.order);

    if (items.length > 0) {
      items[0].unlocked = true;
      for (let i = 1; i < items.length; i += 1) {
        const prev = items[i - 1];
        items[i].unlocked = prev.progress.status === "passed";
      }
    }
    
    for (const item of items) {
      item.itemCount = item.items.length;
    }
    // PATCH (append-only): normalizar campos de item antes do retorno, logo antes do 'return res.json({ items });'
    // Normalização de campos úteis para o front (evita depender de payload_ref bruto)
    for (const mod of items) {
      for (const it of (mod.items as any[])) {
        const ref = it.payload_ref || {};
        if (it.type === "video") {
          it.playbackId =
            ref.mux_playback_id ||
            ref.muxPlaybackId ||
            ref.playback_id ||
            ref.playbackId ||
            null;
        } else if (it.type === "text") {
          it.docMeta = {
            docId: ref.doc_id || ref.docId || null,
            title: ref.title || null,
          };
        }
      }
    }    

    return res.json({ items });
  } catch (err) {
    console.error("progress.meItems", err);
    return res.status(500).json({ error: "items_fetch_failed" });
  }
}

router.get("/me/items", requireAuth, meItemsHandler);

// alias opcional (mesmo payload do /me/items)
router.get("/me/modules", requireAuth, meItemsHandler);

router.get("/me/progress", async (req: Request, res: Response) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  const maybeCourseId = req.query?.courseId;
  const courseId = Array.isArray(maybeCourseId) ? maybeCourseId[0] : maybeCourseId;
  if (courseId && !isUuid(String(courseId))) {
    return res.status(400).json({ error: "invalid_id", param: "courseId" });
  }

  const { rows } = await pool.query(
    `
    select module_id, status, score, time_spent_secs, updated_at
    from progress
    where user_id = $1
    order by updated_at desc
    `,
    [userId]
  );
  res.json({
    modules: rows.map((r) => ({
      moduleId: r.module_id,
      status: r.status,
      score: r.score ? Number(r.score) : null,
      timeSpentSecs: Number(r.time_spent_secs || 0),
      updatedAt: r.updated_at,
    })),
  });
});

const Patch = z.object({
  events: z
    .array(
      z.object({
        type: z.enum(["started", "paused", "seeked", "completed", "heartbeat"]),
        itemId: z.string().uuid(),
        dt: z.string().datetime().optional(),
        deltaSecs: z.number().int().optional().default(0),
      })
    )
    .min(1),
});

router.patch("/me/progress", async (req: Request, res: Response) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  const parsed = Patch.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const client = await pool.connect();
  try {
    await client.query("begin");

    // mapeia item -> módulo
    const itemIds = [...new Set(parsed.data.events.map((e) => e.itemId))];
    const { rows: maps } = await client.query(
      `select id as item_id, module_id from module_items where id = any($1::uuid[])`,
      [itemIds]
    );
    const toModule = new Map<string, string>(maps.map((m) => [m.item_id, m.module_id]));

    let totalDelta = 0;
    for (const e of parsed.data.events) {
      const moduleId = toModule.get(e.itemId);
      if (!moduleId) continue;

      const dt = e.dt ? new Date(e.dt) : new Date();
      const delta = Math.max(e.deltaSecs || 0, 0);
      totalDelta += delta;

      const eventId = ulid();
      await client.query(
        `insert into event_log(event_id, topic, actor_user_id, entity_type, entity_id, occurred_at, source, payload)
         values ($1,$2,$3,'module',$4,$5,'app',$6)`,
        [
          eventId,
          `progress.${e.type}`,
          userId,
          moduleId,
          dt,
          { itemId: e.itemId, deltaSecs: delta },
        ]
      );

      await client.query(
        `
        insert into progress(user_id, module_id, status, score, time_spent_secs, updated_at)
        values ($1,$2,$3,null,$4, now())
        on conflict (user_id, module_id)
        do update set
          time_spent_secs = progress.time_spent_secs + excluded.time_spent_secs,
          status = case
            when excluded.status='completed' then 'completed'
            when progress.status in ('passed','completed') then progress.status
            else excluded.status
          end,
          updated_at = now()
        `,
        [userId, moduleId, e.type === "completed" ? "completed" : "started", delta]
      );
    }

    await client.query("commit");
    return res.status(204).send();
  } catch (err) {
    await client.query("rollback");
    return res.status(500).json({ error: "progress_update_failed" });
  } finally {
    client.release();
  }
});

router.get("/me/entitlements", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.userId ?? (req as any)?.user?.id ?? null;
    if (!userId) return res.status(401).json({ error: "no_user" });

    const entitlements = await withClient((client) =>
      getActiveEntitlements(client, userId)
    );
    return res.json({ entitlements });
  } catch (e) {
    console.error("GET /me/entitlements error:", e);
    return res.status(500).json({ error: "server_error" });
  }
});

router.get("/me/modules-summary", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.userId ?? (req as any)?.user?.id ?? null;
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    const courseIdRaw = req.query?.courseId;
    const courseId = Array.isArray(courseIdRaw) ? courseIdRaw[0] : courseIdRaw;
    if (!courseId || !isUuid(String(courseId))) {
      return res.status(400).json({ error: "invalid_id", param: "courseId" });
    }
    const normalizedCourseId = String(courseId);

    const { rows: modules } = await pool.query<{
      id: string;
      title: string;
      order: number;
    }>(
      `select id, title, "order" from modules where course_id = $1 order by "order", id`,
      [normalizedCourseId]
    );

    if (modules.length === 0) {
      return res.json({ items: [] });
    }

    const moduleIds = modules.map((m) => m.id);
    const { rows: progressRows } = await pool.query<ModuleProgressRow>(
      `
        select module_id, status, score, time_spent_secs
          from progress
         where user_id = $1 and module_id = any($2::uuid[])
      `,
      [userId, moduleIds]
    );
    const progressById = new Map<string, ModuleProgressRow>();
    progressRows.forEach((row) => {
      progressById.set(row.module_id, row);
    });

    const unlockedById = new Map<string, boolean>();
    modules.forEach((mod, index) => {
      if (index === 0) {
        unlockedById.set(mod.id, true);
      } else {
        const prev = modules[index - 1];
        const prevProgress = progressById.get(prev.id);
        unlockedById.set(mod.id, prevProgress?.status === "passed");
      }
    });

    const items = modules.map((mod) => {
      const p = progressById.get(mod.id);
      return {
        id: mod.id,
        title: mod.title,
        order: Number(mod.order),
        unlocked: Boolean(unlockedById.get(mod.id)),
        progress: {
          status: p?.status ?? "not_started",
          score: Number(p?.score ?? 0),
          timeSpentSecs: Number(p?.time_spent_secs ?? 0),
        },
      };
    });

    return res.json({ items });
  } catch (err) {
    console.error("me/modules-summary error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

router.get("/me/progress-summary", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.auth?.userId ?? (req as any)?.user?.id ?? null;
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    const courseIdRaw = req.query?.courseId;
    const courseId = Array.isArray(courseIdRaw) ? courseIdRaw[0] : courseIdRaw;
    if (!courseId || !isUuid(String(courseId))) {
      return res.status(400).json({ error: "invalid_id", param: "courseId" });
    }
    const normalizedCourseId = String(courseId);

    const { rows: modules } = await pool.query<{ id: string }>(
      `select id from modules where course_id = $1 order by "order", id`,
      [normalizedCourseId]
    );

    const moduleIds = modules.map((m) => m.id);
    if (moduleIds.length === 0) {
      return res.json({ totals: { total: 0, passed: 0, started: 0, not_started: 0 }, percent: 0 });
    }

    const { rows } = await pool.query<ModuleStatusRow>(
      `select module_id, status from progress where user_id = $1 and module_id = any($2::uuid[])`,
      [userId, moduleIds]
    );
    const statusByModule = new Map<string, string | null>();
    rows.forEach((row) => {
      statusByModule.set(row.module_id, row.status);
    });

    const totals = { total: moduleIds.length, passed: 0, started: 0, not_started: 0 };
    modules.forEach((mod) => {
      const status = statusByModule.get(mod.id) ?? "not_started";
      if (status === "passed") totals.passed += 1;
      else if (["started", "failed", "completed"].includes(status)) totals.started += 1;
      else totals.not_started += 1;
    });

    const percent = totals.total ? Math.round((totals.passed / totals.total) * 100) : 0;
    return res.json({ totals, percent });
  } catch (err) {
    console.error("me/progress-summary error", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// ===== ADD: POST /api/me/certificates/:courseId/issue =====
// Observações:
// - Alias “/me” autenticado para o fluxo de emissão do próprio aluno.
// - Reutiliza issueCertificate (mesma lógica do módulo de certificados).
// - Retorna verifyUrl e pdf_url consistentes.
function publicBase(req: Request) {
  const envBase = process.env.APP_BASE_URL?.trim();
  if (envBase) return envBase.replace(/\/+$/, "");
  const host = req.get("host") ?? "";
  return `${req.protocol}://${host}`;
}
function buildPdfUrl(base: string, userId: string, courseId: string, hash?: string | null) {
  const path = `/api/certificates/${encodeURIComponent(userId)}/${encodeURIComponent(courseId)}.pdf`;
  if (hash) return `${base}${path}?h=${encodeURIComponent(hash)}`;
  return `${base}${path}`;
}

router.post("/me/certificates/:courseId/issue", async (req: Request, res: Response) => {
  const userId = req.auth?.userId;
  const courseId = String(req.params.courseId || "");
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  if (!isUuid(courseId)) return res.status(400).json({ error: "invalid_course_id" });

  const reissue = String(req.query.reissue || "") === "1";
  const keepIssuedAt = String(req.query.keepIssuedAt || "") === "1";
  const fullNameQ =
    typeof req.query.fullName === "string" ? req.query.fullName.trim() : undefined;
  const fullName = fullNameQ && fullNameQ.length > 0 ? fullNameQ : undefined;

  try {
    const row = await withClient((client) =>
      issueCertificate({
        client,
        userId,
        courseId,
        reissue,
        keepIssuedAt,
        fullName,
      })
    );

    const base = publicBase(req);
    const verifyUrl = row.serial ? `${base}/api/certificates/verify/${row.serial}` : null;
    const pdfUrl = buildPdfUrl(base, row.user_id, row.course_id, row.hash);

    return res.json({
      id: row.id,
      user_id: row.user_id,
      course_id: row.course_id,
      issued_at: row.issued_at,
      pdf_url: pdfUrl,
      serial: row.serial ?? null,
      hash: row.hash ?? null,
      verifyUrl,
      reissue,
      keepIssuedAt,
    });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (/eligible|not_eligible|forbidden/i.test(msg)) {
      return res.status(409).json({ error: "not_eligible", detail: msg });
    }
    return res.status(500).json({ error: "issue_failed", detail: msg });
  }  
});

export default router;
