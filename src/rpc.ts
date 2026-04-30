import {
  type PublicClient,
  createPublicClient,
  fallback,
  http,
  webSocket,
} from "viem";
import type { BotConfig } from "./config.js";
import { log } from "./log.js";

export interface RpcPool {
  /** Resilient public client (uses viem fallback - first healthy URL wins). */
  publicClient: PublicClient;
  /** Per-URL public clients used for racing reads & broadcasts. */
  raceClients: PublicClient[];
  /** Optional WebSocket client for `newHeads` subscription. */
  wsClient: PublicClient | undefined;
}

export function buildRpcPool(config: BotConfig): RpcPool {
  const raceClients = config.rpcUrls.map((url) =>
    createPublicClient({
      chain: config.chain,
      transport: http(url, { timeout: 5_000, retryCount: 0 }),
    }),
  );

  const publicClient = createPublicClient({
    chain: config.chain,
    transport: fallback(
      config.rpcUrls.map((url) =>
        http(url, { timeout: 5_000, retryCount: 1 }),
      ),
      { rank: { interval: 30_000, sampleCount: 3 } },
    ),
  });

  const wsClient = config.wsUrl
    ? createPublicClient({
        chain: config.chain,
        transport: webSocket(config.wsUrl, { retryCount: 5 }),
      })
    : undefined;

  return { publicClient, raceClients, wsClient };
}

/**
 * Race `fn` across all clients in parallel, return the first successful result.
 * If all fail, throw an aggregate error.
 */
export async function race<T>(
  clients: PublicClient[],
  fn: (client: PublicClient) => Promise<T>,
  label: string,
): Promise<T> {
  const errors: unknown[] = [];

  return new Promise<T>((resolveOuter, rejectOuter) => {
    let pending = clients.length;
    let resolved = false;

    clients.forEach((client, i) => {
      fn(client)
        .then((result) => {
          if (resolved) return;
          resolved = true;
          log.debug(`race[${label}] winner = client #${i}`);
          resolveOuter(result);
        })
        .catch((err: unknown) => {
          errors.push(err);
          pending -= 1;
          if (pending === 0 && !resolved) {
            rejectOuter(
              new AggregateError(
                errors as Error[],
                `race[${label}] all ${clients.length} clients failed`,
              ),
            );
          }
        });
    });
  });
}
