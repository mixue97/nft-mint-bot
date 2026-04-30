import {
  type Account,
  type Hex,
  type PublicClient,
  type WalletClient,
  createWalletClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { BotConfig } from "./config.js";

export interface Signer {
  account: Account;
  walletClient: WalletClient;
  /** Allocate the next nonce in a strictly increasing order. */
  nextNonce(): number;
  /** Reset internal nonce counter to the on-chain pending value. */
  resyncNonce(publicClient: PublicClient): Promise<number>;
}

export function buildSigner(config: BotConfig, transportUrl: string): Signer {
  const account = privateKeyToAccount(config.privateKey as Hex);
  const walletClient = createWalletClient({
    account,
    chain: config.chain,
    transport: http(transportUrl),
  });

  let nonce = 0;
  let initialised = false;

  return {
    account,
    walletClient,
    nextNonce(): number {
      if (!initialised) {
        throw new Error("Nonce not initialised - call resyncNonce() first");
      }
      const n = nonce;
      nonce += 1;
      return n;
    },
    async resyncNonce(publicClient: PublicClient): Promise<number> {
      nonce = await publicClient.getTransactionCount({
        address: account.address,
        blockTag: "pending",
      });
      initialised = true;
      return nonce;
    },
  };
}
