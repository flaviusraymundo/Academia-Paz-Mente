// Mantém um único augment do Request com o shape completo
import "express-serve-static-core";

declare module "express-serve-static-core" {
  interface Request {
    auth?: {
      userId?: string;
      email?: string;
      isAdmin?: boolean;
    };
    user?: { id?: string; email?: string };
  }
}

export {};


