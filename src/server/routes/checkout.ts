// src/server/routes/checkout.ts
import { Router, Request, Response } from "express";
import { z } from "zod";
import { stripe } from "../lib/stripe.js";

const router = Router();

const Body = z.object({
  mode: z.enum(["payment", "subscription"]),
  priceId: z.string(),
  courseId: z.string().uuid().optional().nullable(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

router.post("/session", async (req: Request, res: Response) => {
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { mode, priceId, courseId } = parsed.data;
  const base = process.env.APP_BASE_URL || "http://localhost:3000";

  const success_url = parsed.data.successUrl || `${base}/checkout/success?mode=${mode}`;
  const cancel_url = parsed.data.cancelUrl || `${base}/checkout/cancel`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url,
      cancel_url,
      customer_email: req.auth?.email,
      allow_promotion_codes: true,
      client_reference_id: req.auth?.userId,
      metadata: {
        user_id: req.auth?.userId || "",
        course_id: courseId || "",
      },
      ...(mode === "subscription"
        ? {
            subscription_data: {
              metadata: {
                user_id: req.auth?.userId || "",
              },
            },
          }
        : {}),
    });

    return res.json({ url: session.url });
  } catch (e: any) {
    return res.status(500).json({ error: "stripe_error", detail: e.message });
  }
});

export default router;
