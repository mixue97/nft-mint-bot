import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type Abi,
  type Address,
  type Chain,
  type Hex,
  parseGwei,
  isAddress,
  isHex,
} from "viem";
import {
  arbitrum,
  base,
  bsc,
  mainnet,
  optimism,
  polygon,
  sepolia,
} from "viem/chains";
import { DEFAULT_MINT_ABI } from "./abi.js";

loadEnv();

export type PrivateTxMode = "protect" | "bundle" | "public";

export interface BotConfig {
  privateKey: Hex;
  chain: Chain;
  rpcUrls: string[];
  wsUrl: string | undefined;

  privateTxMode: PrivateTxMode;
  flashbotsRelay: string;
  flashbotsProtectRpc: string;

  nftContract: Address;
  mintFunction: string;
  mintArgs: unknown[];
  mintValueWei: bigint;
  gasLimitOverride: bigint;
  rawCalldata: Hex | undefined;
  abi: Abi;

  mintTimestamp: number;
  leadTimeMs: number;

  maxFeePerGas: bigint;
  priorityFeePerGas: bigint;
  tipLadderGwei: bigint[];

  requireSim: boolean;
  maxRetryBlocks: number;
}

const CHAINS: Record<string, Chain> = {
  mainnet,
  ethereum: mainnet,
  sepolia,
  base,
  arbitrum,
  optimism,
  polygon,
  bsc,
};

function required(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function asHex(value: string, name: string): Hex {
  if (!isHex(value)) throw new Error(`${name} must be 0x-prefixed hex`);
  return value;
}

function asAddress(value: string, name: string): Address {
  if (!isAddress(value)) throw new Error(`${name} is not a valid address`);
  return value as Address;
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseBigInt(value: string | undefined, fallback: bigint): bigint {
  if (!value) return fallback;
  return BigInt(value);
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) throw new Error(`Invalid integer: ${value}`);
  return n;
}

function loadAbi(): Abi {
  const path = process.env.MINT_ABI_PATH;
  if (!path) return DEFAULT_MINT_ABI as unknown as Abi;
  const abs = resolve(process.cwd(), path);
  if (!existsSync(abs)) {
    throw new Error(`MINT_ABI_PATH points to missing file: ${abs}`);
  }
  const raw = readFileSync(abs, "utf8");
  const parsed = JSON.parse(raw) as Abi | { abi: Abi };
  if (Array.isArray(parsed)) return parsed;
  if ("abi" in parsed) return parsed.abi;
  throw new Error(`Could not parse ABI from ${abs}`);
}

export function loadConfig(): BotConfig {
  const chainName = (process.env.CHAIN ?? "mainnet").toLowerCase();
  const chain = CHAINS[chainName];
  if (!chain) {
    throw new Error(
      `Unknown CHAIN '${chainName}'. Supported: ${Object.keys(CHAINS).join(", ")}`,
    );
  }

  const rpcUrls = parseList(required("RPC_URLS"));
  if (rpcUrls.length === 0) throw new Error("RPC_URLS must contain >= 1 URL");

  const privateTxMode = (process.env.PRIVATE_TX_MODE ?? "protect") as PrivateTxMode;
  if (!["protect", "bundle", "public"].includes(privateTxMode)) {
    throw new Error(`Invalid PRIVATE_TX_MODE: ${privateTxMode}`);
  }

  const rawCalldataEnv = process.env.RAW_CALLDATA?.trim();
  const rawCalldata =
    rawCalldataEnv && rawCalldataEnv.length > 0
      ? asHex(rawCalldataEnv, "RAW_CALLDATA")
      : undefined;

  const mintArgsRaw = process.env.MINT_ARGS ?? "[]";
  let mintArgs: unknown[];
  try {
    const parsed = JSON.parse(mintArgsRaw);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    mintArgs = parsed;
  } catch (err) {
    throw new Error(
      `MINT_ARGS must be a JSON array (got '${mintArgsRaw}'): ${(err as Error).message}`,
    );
  }

  const tipLadderGwei = parseList(process.env.TIP_LADDER_GWEI ?? "5").map(
    (s) => parseGwei(s),
  );
  if (tipLadderGwei.length === 0) tipLadderGwei.push(parseGwei("5"));

  return {
    privateKey: asHex(required("PRIVATE_KEY"), "PRIVATE_KEY"),
    chain,
    rpcUrls,
    wsUrl: process.env.WS_URL || undefined,

    privateTxMode,
    flashbotsRelay:
      process.env.FLASHBOTS_RELAY ?? "https://relay.flashbots.net",
    flashbotsProtectRpc:
      process.env.FLASHBOTS_PROTECT_RPC ?? "https://rpc.flashbots.net/fast",

    nftContract: asAddress(required("NFT_CONTRACT"), "NFT_CONTRACT"),
    mintFunction: process.env.MINT_FUNCTION ?? "mint",
    mintArgs,
    mintValueWei: parseBigInt(process.env.MINT_VALUE_WEI, 0n),
    gasLimitOverride: parseBigInt(process.env.GAS_LIMIT, 0n),
    rawCalldata,
    abi: loadAbi(),

    mintTimestamp: parseInteger(process.env.MINT_TIMESTAMP, 0),
    leadTimeMs: parseInteger(process.env.LEAD_TIME_MS, 400),

    maxFeePerGas: parseGwei(process.env.MAX_FEE_PER_GAS_GWEI ?? "50"),
    priorityFeePerGas: parseGwei(process.env.PRIORITY_FEE_GWEI ?? "5"),
    tipLadderGwei,

    requireSim: (process.env.REQUIRE_SIM ?? "1") !== "0",
    maxRetryBlocks: parseInteger(process.env.MAX_RETRY_BLOCKS, 3),
  };
}
