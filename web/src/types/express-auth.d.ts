// src/types/express-auth.d.ts
import "express";

declare module "express-serve-static-core" {
  interface Request {
    auth?: {
      userId?: string | null;
      email?: string | null;
      isAdmin?: boolean; // <- adiciona suporte a isAdmin
    };
  }
}
