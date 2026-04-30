/**
 * Deploy MockFCFSMint to a testnet (Sepolia by default) so you can rehearse
 * the bot end-to-end without real money.
 *
 * Reads from .env (same as the bot itself). Recognised vars:
 *   PRIVATE_KEY        - deployer wallet (must hold testnet ETH)
 *   CHAIN              - sepolia | base | arbitrum | ...
 *   RPC_URLS           - first URL is used for deployment
 *   MOCK_NAME          - default "RehearsalNFT"
 *   MOCK_SYMBOL        - default "REHRSE"
 *   MOCK_MAX_SUPPLY    - default 100
 *   MOCK_MINT_PRICE_WEI- default 0
 *   MOCK_MINT_START    - unix seconds; default = now + 5 minutes
 *   MOCK_MAX_PER_WALLET- default 5
 *
 * Usage: npm run deploy-mock
 */
import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Abi,
  type Hex,
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  isHex,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  bsc,
  bscTestnet,
  holesky,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  sepolia,
} from "viem/chains";

loadEnv();

const CHAINS: Record<string, ReturnType<typeof getChain>> = {} as never;
function getChain(name: string) {
  switch (name) {
    case "mainnet":
    case "ethereum":
      return mainnet;
    case "sepolia":
      return sepolia;
    case "holesky":
      return holesky;
    case "base":
      return base;
    case "base-sepolia":
    case "basesepolia":
      return baseSepolia;
    case "arbitrum":
      return arbitrum;
    case "arbitrum-sepolia":
    case "arbitrumsepolia":
      return arbitrumSepolia;
    case "optimism":
      return optimism;
    case "optimism-sepolia":
    case "optimismsepolia":
      return optimismSepolia;
    case "polygon":
      return polygon;
    case "polygon-amoy":
    case "amoy":
      return polygonAmoy;
    case "bsc":
      return bsc;
    case "bsc-testnet":
    case "bsctestnet":
      return bscTestnet;
    default:
      throw new Error(
        `Unknown CHAIN '${name}'. Use sepolia/holesky/base-sepolia/etc.`,
      );
  }
}
void CHAINS;

interface Artifact {
  abi: Abi;
  bytecode: Hex;
}

function loadArtifact(): Artifact {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, "mockFcfsMint.compiled.json");
  if (!existsSync(path)) {
    throw new Error(
      `Missing ${path}. Run \`npm run compile-mock\` first.`,
    );
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    abi: Abi;
    bytecode: string;
  };
  if (!isHex(raw.bytecode)) {
    throw new Error("compiled bytecode is not a 0x-prefixed hex string");
  }
  return { abi: raw.abi, bytecode: raw.bytecode };
}

function asHex(v: string | undefined, name: string): Hex {
  if (!v) throw new Error(`Missing ${name}`);
  if (!isHex(v)) throw new Error(`${name} must be 0x-prefixed hex`);
  return v;
}

async function main(): Promise<void> {
  const chainName = (process.env.CHAIN ?? "sepolia").toLowerCase();
  const chain = getChain(chainName);

  const rpcUrls = (process.env.RPC_URLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (rpcUrls.length === 0) {
    throw new Error("RPC_URLS missing (need at least one testnet RPC)");
  }
  const transportUrl = rpcUrls[0]!;

  const account = privateKeyToAccount(asHex(process.env.PRIVATE_KEY, "PRIVATE_KEY"));
  const publicClient = createPublicClient({ chain, transport: http(transportUrl) });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(transportUrl),
  });

  const balance = await publicClient.getBalance({ address: account.address });
  if (balance === 0n) {
    throw new Error(
      `Deployer ${account.address} has 0 balance on ${chain.name}. ` +
        `Fund it from a faucet first (e.g. https://sepoliafaucet.com).`,
    );
  }

  const name = process.env.MOCK_NAME ?? "RehearsalNFT";
  const symbol = process.env.MOCK_SYMBOL ?? "REHRSE";
  const maxSupply = BigInt(process.env.MOCK_MAX_SUPPLY ?? "100");
  const mintPrice =
    process.env.MOCK_MINT_PRICE_WEI !== undefined
      ? BigInt(process.env.MOCK_MINT_PRICE_WEI)
      : parseEther("0");
  const mintStart =
    process.env.MOCK_MINT_START !== undefined
      ? BigInt(process.env.MOCK_MINT_START)
      : BigInt(Math.floor(Date.now() / 1000) + 300);
  const maxPerWallet = BigInt(process.env.MOCK_MAX_PER_WALLET ?? "5");

  const artifact = loadArtifact();

  console.log("=".repeat(72));
  console.log(`chain         ${chain.name} (${chain.id})`);
  console.log(`deployer      ${account.address}`);
  console.log(`balance       ${formatEther(balance)} ${chain.nativeCurrency.symbol}`);
  console.log(`name/symbol   ${name} / ${symbol}`);
  console.log(`maxSupply     ${maxSupply}`);
  console.log(`mintPrice     ${formatEther(mintPrice)} ${chain.nativeCurrency.symbol}`);
  console.log(
    `mintStart     ${mintStart} (${new Date(Number(mintStart) * 1000).toISOString()})`,
  );
  console.log(`maxPerWallet  ${maxPerWallet}`);
  console.log("=".repeat(72));

  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [name, symbol, maxSupply, mintPrice, mintStart, maxPerWallet],
  });

  console.log(`deploy tx     ${hash}`);
  console.log("waiting for receipt...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Deployment reverted (status=${receipt.status})`);
  }
  if (!receipt.contractAddress) {
    throw new Error("No contractAddress in receipt");
  }

  console.log(`block         ${receipt.blockNumber}`);
  console.log(`gas used      ${receipt.gasUsed}`);
  console.log(`contract      ${receipt.contractAddress}`);
  console.log("");
  console.log("Add this to your .env:");
  console.log(`NFT_CONTRACT=${receipt.contractAddress}`);
  console.log(`MINT_TIMESTAMP=${mintStart}`);
  console.log(`MINT_VALUE_WEI=${mintPrice}`);
  console.log(`MINT_FUNCTION=mint`);
  console.log(`MINT_ARGS=[1]`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
