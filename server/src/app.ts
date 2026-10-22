import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { allowedOrigins, env, isProduction } from './config/env';
import { logger } from './utils/logger';
import { requestId, noStore, originCheck, permissionsPolicy } from './middleware/security';
import { apiLimiter } from './middleware/rateLimit';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { buildRoutes } from './routes';
import { pool } from './db/pool';
import { redis } from './redis/client';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      // Never log bodies or query strings (may contain health information).
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, path: String(req.url).split('?')[0] }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      strictTransportSecurity: isProduction ? { maxAge: 63_072_000, includeSubDomains: true, preload: false } : false,
      frameguard: { action: 'deny' },
      noSniff: true,
    }),
  );
  app.use(permissionsPolicy);

  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key'],
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '10kb' }));
  app.use(cookieParser());

  app.get('/healthz', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      await redis.ping();
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  app.use('/api', noStore, originCheck, apiLimiter, buildRoutes());
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
