import { setTimeout as delay } from "node:timers/promises";
import type { PublicClient } from "viem";
import { log } from "./log.js";

export interface TriggerArgs {
  /** Unix epoch seconds when the mint contract opens. */
  mintTimestamp: number;
  /** Fire this many ms before the mint timestamp to compensate for RTT. */
  leadTimeMs: number;
  /** WebSocket public client used for `newHeads` (optional). */
  wsClient?: PublicClient;
}

/**
 * Wait until either:
 *   1. We are within `leadTimeMs` of the mint timestamp, OR
 *   2. The chain produces a block whose timestamp >= `mintTimestamp - 12s`
 *      (so we can fire into the activation block).
 *
 * Resolves with the block number we should *target* for inclusion.
 */
export async function waitForTrigger(
  args: TriggerArgs,
  publicClient: PublicClient,
): Promise<{ targetBlock: number; reason: string }> {
  if (args.mintTimestamp <= 0) {
    const head = await publicClient.getBlockNumber();
    return { targetBlock: Number(head) + 1, reason: "mintTimestamp <= 0" };
  }

  const fireAtMs = args.mintTimestamp * 1000 - args.leadTimeMs;
  const now = Date.now();
  const wait = fireAtMs - now;

  log.info(
    `mintTimestamp=${args.mintTimestamp} (${new Date(
      args.mintTimestamp * 1000,
    ).toISOString()})`,
  );
  log.info(
    `leadTime=${args.leadTimeMs}ms -> firing at ${new Date(fireAtMs).toISOString()}` +
      ` (in ${(wait / 1000).toFixed(1)}s)`,
  );

  if (wait > 5_000 && args.wsClient) {
    await raceTimerAndHead(wait, args, args.wsClient);
  } else if (wait > 0) {
    await delay(wait);
  } else {
    log.warn(
      `mintTimestamp already passed by ${-wait}ms - firing at next block`,
    );
  }

  const head = await publicClient.getBlockNumber();
  return { targetBlock: Number(head) + 1, reason: "trigger fired" };
}

/**
 * Returns when either the timer elapses OR a block is produced whose
 * timestamp is within 12s of the mint timestamp (whichever comes first).
 *
 * NOTE: this requires a viem WebSocket transport. We use the low-level
 * RPC method directly to avoid pulling in extra event-emitter API.
 */
async function raceTimerAndHead(
  waitMs: number,
  args: TriggerArgs,
  wsClient: PublicClient,
): Promise<void> {
  let resolved = false;

  const timerPromise = (async () => {
    await delay(waitMs);
    if (!resolved) log.debug("trigger via timer");
  })();

  const headPromise = (async () => {
    try {
      const unwatch = wsClient.watchBlocks({
        onBlock: (block) => {
          if (resolved) return;
          if (block.timestamp >= BigInt(args.mintTimestamp - 12)) {
            log.debug("trigger via newHead, block.timestamp =", block.timestamp);
            resolved = true;
            unwatch();
          }
        },
      });
    } catch (err) {
      log.warn("ws watchBlocks failed - falling back to timer:", err);
    }
  })();

  await Promise.race([timerPromise, headPromise]);
  resolved = true;
}
