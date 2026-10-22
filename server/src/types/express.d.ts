import type { Role, Language } from '../config/constants';

export interface AuthContext {
  userId: string;
  role: Role;
  sessionId: string;
  fullName: string;
  language: Language;
  mfaVerified: boolean;
  reauthAt: Date | null;
  /** HMAC of the session's CSRF token (internal; never sent to clients). */
  csrfHash: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
    }
  }
}

export {};
