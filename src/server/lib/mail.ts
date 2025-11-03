// src/server/lib/mail.ts
// Envio simples via Resend API. Usa fetch nativo do Node 18+.
// Configure RESEND_API_KEY e MAIL_FROM no .env.
// Em desenvolvimento, loga no console.

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const MAIL_FROM = process.env.MAIL_FROM || "";

export async function sendMagicLinkEmail(to: string, url: string) {
  if (!RESEND_API_KEY || !MAIL_FROM) {
    // Dev fallback
    // eslint-disable-next-line no-console
    console.log(`[DEV] Magic link for ${to}: ${url}`);
    return;
  }
  const body = {
    from: MAIL_FROM,
    to: [to],
    subject: "Seu acesso — magic link",
    text: `Clique para entrar: ${url}\nEste link expira em 15 minutos.`,
  };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Resend error: ${msg}`);
  }
}
