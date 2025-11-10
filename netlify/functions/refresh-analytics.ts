// netlify/functions/refresh-analytics.ts
// Agendamento diário para atualizar as materialized views de analytics.
export const config = {
  schedule: "0 5 * * *", // 05:00 UTC diário
};

export async function handler() {
  try {
    const base = process.env.APP_BASE_URL || "https://lifeflourishconsulting.com";
    const url  = `${base}/api/admin/analytics/refresh`;
    const adminToken = (process.env.ADMIN_CRON_JWT || "").trim();
    if (!adminToken) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "missing_ADMIN_CRON_JWT" }),
      };
    }
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const text = await resp.text();
    // Propaga falhas para que o agendamento mostre erro visível.
    if (!resp.ok) {
      return {
        statusCode: resp.status,
        body: JSON.stringify({
          error: "refresh_failed",
          upstream_status: resp.status,
          upstream_body: text
        })
      };
    }
    return {
      statusCode: 200,
      body: JSON.stringify({ status: resp.status, text })
    };
  } catch (e: any) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e?.message || e) }) };
  }
}
