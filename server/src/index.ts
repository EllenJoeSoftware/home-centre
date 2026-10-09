import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { DiscoveryServer, buildDiscoveryReply } from './discovery.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const { app, ctx } = await buildApp(config);

  let interval: NodeJS.Timeout | null = null;
  const discovery =
    config.discoveryPort > 0
      ? new DiscoveryServer({
          port: config.discoveryPort,
          reply: () => buildDiscoveryReply(ctx.serverInfo, config),
          log: app.log,
        })
      : null;
  if (discovery) app.addHook('onClose', async () => discovery.close());

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
  if (discovery) await discovery.start();
  else app.log.info('LAN discovery disabled (DISCOVERY_PORT=0)');
  app.log.info(
    {
      libraries: ctx.libraries.list().map((l) => l.path),
      browseRoots: config.browseRoots,
      dataDir: config.dataDir,
      serverId: ctx.serverInfo.id,
      name: ctx.serverInfo.name,
    },
    'Home Centre server ready',
  );

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
