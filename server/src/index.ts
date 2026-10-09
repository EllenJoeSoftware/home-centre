import { buildApp } from './app.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const { app, ctx } = await buildApp(config);

  let interval: NodeJS.Timeout | null = null;
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    if (interval) clearInterval(interval);
    ctx.scanner.stop();
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });
  app.log.info({ mediaDirs: config.mediaDirs, dataDir: config.dataDir }, 'Home Centre server ready');

  const runScan = () => {
    ctx.scanner.scan().catch((err: unknown) => app.log.error({ err }, 'scan failed'));
  };
  runScan();
  if (config.scanIntervalMinutes > 0) {
    interval = setInterval(runScan, config.scanIntervalMinutes * 60_000);
    interval.unref();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
