import http from 'http';
import { config } from './config';
import { runMigrations } from './db/migrate';
import { pool } from './db/pool';
import { createApp } from './app';
import { runMaintenance, startMaintenance } from './services/maintenance';
import { attachSockets } from './sockets/chat';

async function main(): Promise<void> {
  await runMigrations();
  const app = createApp();
  const server = http.createServer(app);
  attachSockets(server);
  await runMaintenance().catch((err) => console.warn('Mantenimiento inicial falló:', err));
  startMaintenance();
  server.listen(config.port, () => {
    console.log(`TutorHub API escuchando en el puerto ${config.port} (${config.isProduction ? 'producción' : 'desarrollo'})`);
  });
  const shutdown = (): void => {
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('No se pudo iniciar el servidor:', err);
  process.exit(1);
});
