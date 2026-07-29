import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { sql } from 'drizzle-orm';
import { db } from './db/client.js';
import { env } from './env.js';
import { logInfo } from './lib/logger.js';
import { handleError, handleNotFound } from './middleware/error.js';
import type { AppEnv } from './middleware/auth.js';
import { adminAuthRoutes } from './routes/admin-auth.js';
import { authRoutes } from './routes/auth.js';
import { catalogRoutes } from './routes/catalog.js';
import { adminRoutes } from './routes/admin.js';
import { devRoutes } from './routes/dev.js';
import { rideRoutes } from './routes/rides.js';
import { subscriptionRoutes } from './routes/subscriptions.js';
import { telegramWebhookRoutes } from './routes/telegram-webhook.js';
import { meRoutes } from './routes/me.js';
import { adminVehicleRoutes, vehicleRoutes } from './routes/vehicles.js';

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', logger(logInfo));
  // The rider app and admin panel are separate origins; the API is
  // token-authenticated and stateless, so a permissive CORS policy is fine.
  app.use('*', cors({ origin: '*', allowHeaders: ['Content-Type', 'Authorization'] }));

  app.onError(handleError);
  app.notFound(handleNotFound);

  app.get('/health', async (c) => {
    let database: 'up' | 'down' = 'up';
    try {
      await db.execute(sql`SELECT 1`);
    } catch {
      database = 'down';
    }
    return c.json(
      {
        status: database === 'up' ? 'ok' : 'degraded',
        database,
        environment: env.NODE_ENV,
        gateway: env.VEHICLE_GATEWAY,
        time: new Date().toISOString(),
      },
      database === 'up' ? 200 : 503,
    );
  });

  // Rider surface.
  app.route('/auth', authRoutes);
  // Telegram bot updates (gated by the webhook secret, not a bearer token).
  app.route('/telegram', telegramWebhookRoutes);
  app.route('/me', meRoutes);
  app.route('/vehicles', vehicleRoutes);
  app.route('/catalog', catalogRoutes);
  app.route('/rides', rideRoutes);
  app.route('/subscriptions', subscriptionRoutes);

  // Back office.
  app.route('/admin/auth', adminAuthRoutes);
  app.route('/admin/vehicles', adminVehicleRoutes);
  app.route('/admin', adminRoutes);

  // Demo controls. The routes gate themselves on NODE_ENV.
  app.route('/dev', devRoutes);

  return app;
}

export const app = createApp();
