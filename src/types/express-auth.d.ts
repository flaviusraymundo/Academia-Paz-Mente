// amplia o tipo do Express para request.auth conter isAdmin
declare namespace Express {
  export interface Request {
    auth?: {
      userId?: string;
      email?: string;
      isAdmin?: boolean;
    };
  }
}
