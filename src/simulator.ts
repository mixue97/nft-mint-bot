import { type Address, type Hex, type PublicClient, BaseError } from "viem";
import type { BotConfig } from "./config.js";
import { log } from "./log.js";

export interface SimulationResult {
  ok: boolean;
  gasUsed: bigint | undefined;
  error: string | undefined;
}

/**
 * Dry-run the mint transaction with `eth_call` + `eth_estimateGas` so we know
 * (a) it will not revert and (b) what gas limit to use. Run this once before
 * pre-signing so the hot path stays minimal.
 */
export async function simulateMint(
  publicClient: PublicClient,
  config: BotConfig,
  from: Address,
  data: Hex,
): Promise<SimulationResult> {
  try {
    await publicClient.call({
      account: from,
      to: config.nftContract,
      data,
      value: config.mintValueWei,
    });

    const gasUsed = await publicClient.estimateGas({
      account: from,
      to: config.nftContract,
      data,
      value: config.mintValueWei,
    });

    return { ok: true, gasUsed, error: undefined };
  } catch (err) {
    const message = err instanceof BaseError ? err.shortMessage : String(err);
    log.warn("simulation reverted:", message);
    return { ok: false, gasUsed: undefined, error: message };
  }
}
