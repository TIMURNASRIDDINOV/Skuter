import { serve } from '@hono/node-server';
import { app } from './app.js';
import { closeDatabase } from './db/client.js';
import { env } from './env.js';
import { startVehicleGateway, stopVehicleGateway } from './gateway/index.js';
import { logError, logInfo, write } from './lib/logger.js';
import { repositories } from './repositories/index.js';

async function main(): Promise<void> {
  const vehicleCount = await repositories.vehicles.count();

  await startVehicleGateway();

  const server = serve({ fetch: app.fetch, port: env.API_PORT, hostname: '0.0.0.0' }, (info) => {
    write('');
    write(`API        http://localhost:${info.port}        (health: /health)`);
    write(`DB         ${redactUrl(env.DATABASE_URL)}`);
    write(`Simulator  running, ${vehicleCount} vehicles, tick ${env.SIMULATOR_TICK_MS / 1000}s`);
    write(`Gateway    ${env.VEHICLE_GATEWAY}`);
    write(`Env        ${env.NODE_ENV}`);
    write('');
  });

  const shutdown = (signal: string): void => {
    logInfo(`${signal} received, shutting down`);
    server.close(() => {
      void stopVehicleGateway()
        .then(() => closeDatabase())
        .then(() => {
          process.exit(0);
        });
    });
  };

  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
}

/** Never print credentials, even locally. */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password !== '') parsed.password = '***';
    return parsed.toString();
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

main().catch((error: unknown) => {
  logError('Failed to start API', error);
  process.exitCode = 1;
});
