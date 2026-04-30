import { keccak256, toHex, type Hex } from "viem";
import { sign } from "viem/accounts";
import type { Account } from "viem";
import type { BotConfig } from "./config.js";
import { log } from "./log.js";

export interface BundleResult {
  bundleHash: string;
  targetBlock: number;
}

/**
 * Submit a list of pre-signed raw transactions as a Flashbots bundle.
 *
 * Auth: Flashbots relays require an `X-Flashbots-Signature` header signed by
 * a *separate* searcher key (not your minting key). We re-use the minting
 * account here for simplicity - in production you should use a dedicated
 * reputation key. See: https://docs.flashbots.net/flashbots-auction/searchers/advanced/rpc-endpoint
 */
export async function sendBundle(
  config: BotConfig,
  searcher: Account,
  signedTxs: Hex[],
  targetBlock: number,
): Promise<BundleResult> {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_sendBundle",
    params: [
      {
        txs: signedTxs,
        blockNumber: toHex(targetBlock),
      },
    ],
  };
  const bodyStr = JSON.stringify(body);

  if (!searcher.signMessage) {
    throw new Error("searcher account is missing signMessage capability");
  }

  const signature = await searcher.signMessage({
    message: keccak256(toHex(bodyStr)),
  });

  const res = await fetch(config.flashbotsRelay, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Flashbots-Signature": `${searcher.address}:${signature}`,
    },
    body: bodyStr,
  });

  if (!res.ok) {
    throw new Error(
      `Flashbots relay returned ${res.status}: ${await res.text()}`,
    );
  }

  const json = (await res.json()) as {
    result?: { bundleHash: string };
    error?: { message: string };
  };

  if (json.error) {
    throw new Error(`Flashbots relay error: ${json.error.message}`);
  }
  if (!json.result) {
    throw new Error("Flashbots relay returned no result");
  }

  return { bundleHash: json.result.bundleHash, targetBlock };
}

/**
 * Send a *single* signed transaction through the Flashbots Protect RPC. This
 * is the simplest way to avoid public-mempool front-running on Ethereum
 * mainnet without managing your own bundles.
 */
export async function sendProtectTx(
  config: BotConfig,
  signedTx: Hex,
): Promise<Hex> {
  const res = await fetch(config.flashbotsProtectRpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_sendRawTransaction",
      params: [signedTx],
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Protect RPC returned ${res.status}: ${await res.text()}`,
    );
  }

  const json = (await res.json()) as {
    result?: Hex;
    error?: { message: string };
  };

  if (json.error) throw new Error(`Protect RPC error: ${json.error.message}`);
  if (!json.result) throw new Error("Protect RPC returned no tx hash");

  log.info("protect tx submitted:", json.result);
  return json.result;
}

// Avoid an unused import lint error - `sign` is exposed for callers that want
// to build their own searcher-auth headers manually.
export { sign };
