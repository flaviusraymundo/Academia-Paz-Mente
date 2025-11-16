// src/types/express.d.ts
import "express-serve-static-core";

export type AuthPayload = {
  userId?: string | null;
  email?: string | null;
  isAdmin?: boolean;
};

export type RequestUser = {
  id?: string | null;
  email?: string | null;
  isAdmin?: boolean;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
      user?: RequestUser;
    }
  }
}

export {};
