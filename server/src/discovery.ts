import dgram from 'node:dgram';
import type { FastifyBaseLogger } from 'fastify';
import type { ServerInfo } from './app.js';
import type { Config } from './config.js';

/** Probe payload clients broadcast to find servers (see docs/API.md "LAN discovery"). */
export const DISCOVERY_PROBE = 'HOMECENTRE_DISCOVER';
/** Global cap on replies per second, so the server can't be used as a UDP amplifier. */
export const MAX_REPLIES_PER_SECOND = 20;

export interface DiscoveryReply extends ServerInfo {
  port: number;
  url: string | null;
}

export interface DiscoveryOptions {
  /** UDP port to bind; 0 binds an ephemeral port (tests). Callers skip discovery when DISCOVERY_PORT=0. */
  port: number;
  host?: string;
  /** Builds the reply; called per probe so it always reflects current settings. */
  reply: () => DiscoveryReply;
  log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'debug'>;
}

export function buildDiscoveryReply(info: ServerInfo, config: Config): DiscoveryReply {
  return { ...info, port: config.advertisedPort, url: config.publicUrl };
}

/**
 * UDP responder for LAN discovery. Replies (unicast) with server identity JSON to
 * `HOMECENTRE_DISCOVER` datagrams and ignores everything else.
 */
export class DiscoveryServer {
  private socket: dgram.Socket | null = null;
  private windowStart = 0;
  private windowCount = 0;

  constructor(private readonly opts: DiscoveryOptions) {}

  /**
   * Bind the socket. Resolves to false (after logging a warning) if binding fails, e.g. the
   * port is already in use — discovery is best-effort and must never take the server down.
   */
  start(): Promise<boolean> {
    const { port, host = '0.0.0.0', log } = this.opts;
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;

    return new Promise<boolean>((resolve) => {
      let bound = false;
      socket.on('error', (err) => {
        if (!bound) {
          log.warn({ err, port }, 'LAN discovery disabled: cannot bind UDP port');
          this.socket = null;
          socket.close();
          resolve(false);
          return;
        }
        log.warn({ err }, 'LAN discovery socket error');
      });
      socket.on('message', (msg, rinfo) => this.handle(msg, rinfo));
      socket.bind(port, host, () => {
        bound = true;
        const addr = socket.address();
        log.info({ address: addr.address, port: addr.port }, 'LAN discovery listening (UDP)');
        resolve(true);
      });
    });
  }

  /** Bound UDP port, or null when not listening. */
  get port(): number | null {
    try {
      return this.socket ? this.socket.address().port : null;
    } catch {
      return null;
    }
  }

  close(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return Promise.resolve();
    return new Promise((resolve) => {
      try {
        socket.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  private allowReply(): boolean {
    const now = Date.now();
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.windowCount = 0;
    }
    if (this.windowCount >= MAX_REPLIES_PER_SECOND) return false;
    this.windowCount++;
    return true;
  }

  private handle(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    if (msg.length > 64 || msg.toString('utf8').trim() !== DISCOVERY_PROBE) return;
    if (!this.allowReply()) return;
    const socket = this.socket;
    if (!socket) return;
    const payload = Buffer.from(JSON.stringify(this.opts.reply()), 'utf8');
    socket.send(payload, rinfo.port, rinfo.address, (err) => {
      if (err) this.opts.log.debug({ err, to: rinfo.address }, 'discovery reply failed');
    });
  }
}
