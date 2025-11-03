// Augmenta o tipo Request para aceitar req.auth
// Certifique-se de que "src/types/**/*.d.ts" está incluído no tsconfig
import "express-serve-static-core";

declare module "express-serve-static-core" {
  interface Request {
    auth?: {
      userId?: string;
      email?: string;
    };
  }
}

