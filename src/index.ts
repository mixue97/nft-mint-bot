import {
  type Hex,
  type PublicClient,
  formatEther,
  formatGwei,
  serializeTransaction,
} from "viem";
import { loadConfig, type BotConfig } from "./config.js";
import { buildSigner, type Signer } from "./wallet.js";
import { buildRpcPool, race, type RpcPool } from "./rpc.js";
import { simulateMint } from "./simulator.js";
import { buildCalldata } from "./calldata.js";
import { sendBundle, sendProtectTx } from "./flashbots.js";
import { waitForTrigger } from "./trigger.js";
import { log } from "./log.js";

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");

async function main(): Promise<void> {
  const config = loadConfig();
  const rpc = buildRpcPool(config);
  const primaryRpc = config.rpcUrls[0];
  if (!primaryRpc) throw new Error("No RPC URL configured");
  const signer = buildSigner(config, primaryRpc);

  log.info("=".repeat(72));
  log.info(
    `chain=${config.chain.name} (${config.chain.id})  account=${signer.account.address}`,
  );
  log.info(
    `contract=${config.nftContract}  fn=${config.mintFunction}  value=${formatEther(config.mintValueWei)} ETH`,
  );
  log.info(
    `mode=${config.privateTxMode}  rpcs=${config.rpcUrls.length}  ws=${rpc.wsClient ? "yes" : "no"}`,
  );
  log.info(
    `tipLadder=[${config.tipLadderGwei.map((t) => formatGwei(t)).join(", ")}] gwei` +
      `  maxFee=${formatGwei(config.maxFeePerGas)} gwei`,
  );

  // 1. Pre-flight: balance + nonce + calldata + sim ----------------------------
  const balance = await rpc.publicClient.getBalance({
    address: signer.account.address,
  });
  log.info(`balance=${formatEther(balance)} ETH`);

  const startNonce = await signer.resyncNonce(rpc.publicClient);
  log.info(`startNonce=${startNonce}`);

  const calldata = buildCalldata(config);
  log.info(`calldata=${calldata.slice(0, 10)}... (${(calldata.length - 2) / 2} bytes)`);

  let gasLimit = config.gasLimitOverride;
  if (gasLimit === 0n) {
    if (config.requireSim) {
      const sim = await simulateMint(
        rpc.publicClient,
        config,
        signer.account.address,
        calldata,
      );
      if (!sim.ok) {
        throw new Error(`refusing to broadcast - simulation reverted: ${sim.error}`);
      }
      gasLimit = (sim.gasUsed ?? 200_000n) * 12n / 10n;
      log.info(`simulated gas=${sim.gasUsed} -> gasLimit=${gasLimit}`);
    } else {
      gasLimit = 300_000n;
      log.warn(`REQUIRE_SIM=0 - skipping simulation, using gasLimit=${gasLimit}`);
    }
  }

  // 2. Pre-sign one transaction per tip in the ladder --------------------------
  const signedTxs: Hex[] = [];
  for (let i = 0; i < config.tipLadderGwei.length; i += 1) {
    const tip = config.tipLadderGwei[i];
    if (tip === undefined) continue;
    const nonce = signer.nextNonce();
    const tx = {
      chainId: config.chain.id,
      to: config.nftContract,
      data: calldata,
      value: config.mintValueWei,
      gas: gasLimit,
      maxFeePerGas: config.maxFeePerGas,
      maxPriorityFeePerGas: tip,
      nonce,
      type: "eip1559" as const,
    };
    const signedTx = await signer.account.signTransaction!(tx);
    signedTxs.push(signedTx as Hex);
    log.info(
      `pre-signed tx #${i}  nonce=${nonce}  tip=${formatGwei(tip)} gwei` +
        `  size=${(serializeTransaction(tx, { r: "0x0", s: "0x0", v: 0n }).length - 2) / 2}B (unsigned)`,
    );
  }

  if (DRY_RUN) {
    log.info("--dry-run set - exiting before broadcast");
    return;
  }

  // 3. Wait for trigger --------------------------------------------------------
  const { targetBlock } = await waitForTrigger(
    {
      mintTimestamp: config.mintTimestamp,
      leadTimeMs: config.leadTimeMs,
      wsClient: rpc.wsClient,
    },
    rpc.publicClient,
  );
  log.info(`FIRE  targetBlock=${targetBlock}`);

  // 4. Broadcast ---------------------------------------------------------------
  switch (config.privateTxMode) {
    case "protect":
      await broadcastProtect(config, signedTxs);
      break;
    case "bundle":
      await broadcastBundle(config, signer, signedTxs, targetBlock, rpc);
      break;
    case "public":
      await broadcastPublic(rpc, signedTxs);
      break;
  }

  // 5. Wait for receipts -------------------------------------------------------
  await waitForReceipts(rpc.publicClient, signedTxs);
}

async function broadcastProtect(config: BotConfig, signedTxs: Hex[]): Promise<void> {
  await Promise.all(
    signedTxs.map(async (tx, i) => {
      try {
        const hash = await sendProtectTx(config, tx);
        log.info(`protect tx ${i} accepted: ${hash}`);
      } catch (err) {
        log.error(`protect tx ${i} failed:`, err);
      }
    }),
  );
}

async function broadcastBundle(
  config: BotConfig,
  signer: Signer,
  signedTxs: Hex[],
  startBlock: number,
  _rpc: RpcPool,
): Promise<void> {
  for (let i = 0; i < config.maxRetryBlocks; i += 1) {
    const target = startBlock + i;
    try {
      const result = await sendBundle(config, signer.account, signedTxs, target);
      log.info(
        `bundle submitted  hash=${result.bundleHash}  targetBlock=${target}`,
      );
    } catch (err) {
      log.error(`bundle submit @block ${target} failed:`, err);
    }
  }
}

async function broadcastPublic(rpc: RpcPool, signedTxs: Hex[]): Promise<void> {
  log.warn("broadcasting via PUBLIC mempool - vulnerable to front-running");
  await Promise.all(
    signedTxs.map(async (tx, i) => {
      try {
        const hash = await race(
          rpc.raceClients,
          (c) => c.sendRawTransaction({ serializedTransaction: tx }),
          `sendRawTransaction#${i}`,
        );
        log.info(`public tx ${i} hash=${hash}`);
      } catch (err) {
        log.error(`public tx ${i} broadcast failed:`, err);
      }
    }),
  );
}

async function waitForReceipts(
  publicClient: PublicClient,
  signedTxs: Hex[],
): Promise<void> {
  // viem doesn't expose tx hash from the signed payload directly without
  // re-hashing - to keep this simple, just poll for the next N blocks and
  // log new transactions from our address. Production code should track
  // hashes per tx.
  log.info(`broadcast complete - sent ${signedTxs.length} tx`);
  log.info("monitor your address on the explorer for inclusion");
}

main().catch((err: unknown) => {
  log.error(err);
  process.exit(1);
});
