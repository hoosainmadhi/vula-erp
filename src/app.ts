import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Express } from 'express';
import { config } from './config.js';
import { getDb } from './db.js';
import { apiRouter } from './routes/index.js';
import { errorHandler, notFoundHandler } from './utils/http.js';
import { logger } from './utils/logger.js';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; connect-src 'self'",
    );
    const started = Date.now();
    res.on('finish', () => {
      logger.debug(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms`);
    });
    next();
  });

  const health = (_req: express.Request, res: express.Response) => {
    try {
      getDb().prepare('SELECT 1').get();
      res.json({ status: 'ok', uptime: process.uptime() });
    } catch (error) {
      res.status(503).json({
        status: 'unavailable',
        error: error instanceof Error ? error.message : 'db error',
      });
    }
  };
  app.get('/health', health);
  app.get('/api/health', health);

  app.use(express.json({ limit: '1mb' }));
  app.use('/api', apiRouter);

  const frontendDist = path.resolve('frontend/dist');
  if (config.nodeEnv === 'production' && fs.existsSync(frontendDist)) {
    app.use(
      express.static(frontendDist, {
        index: false,
        maxAge: '1y',
        immutable: true,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
