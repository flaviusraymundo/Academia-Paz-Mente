// src/server/lib/stripe.ts
import Stripe from "stripe";

const DEV = process.env.DEV_FAKE === "1";
export const stripe = DEV
  ? ({
      checkout: {
        sessions: {
          create: async () => ({ url: "http://localhost:3000/mock-checkout" }),
        },
      },
    } as any)
  : new Stripe(process.env.STRIPE_SECRET_KEY as string, { apiVersion: "2024-06-20" });
