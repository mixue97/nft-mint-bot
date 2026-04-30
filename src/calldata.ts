import { type Hex, encodeFunctionData } from "viem";
import type { BotConfig } from "./config.js";

/**
 * Build calldata once, ahead of mint time, so the hot path only signs and
 * broadcasts. Honours RAW_CALLDATA override for unverified contracts.
 */
export function buildCalldata(config: BotConfig): Hex {
  if (config.rawCalldata) return config.rawCalldata;

  return encodeFunctionData({
    abi: config.abi,
    functionName: config.mintFunction,
    args: config.mintArgs,
  });
}
