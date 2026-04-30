/**
 * Compile contracts/MockFCFSMint.sol with solc-js and write the result to
 * scripts/mockFcfsMint.compiled.json so deployMock.ts can deploy without
 * needing solc at runtime.
 *
 * Usage:  npm run compile-mock
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
type SolcImportResult = { contents: string } | { error: string };
type SolcReadCallback = {
  import: (path: string) => SolcImportResult;
};
const solc: {
  compile(input: string, callbacks?: SolcReadCallback): string;
  version(): string;
} = require_("solc");

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const contractPath = resolve(root, "contracts/MockFCFSMint.sol");
const outPath = resolve(here, "mockFcfsMint.compiled.json");

if (!existsSync(contractPath)) {
  throw new Error(`Contract not found at ${contractPath}`);
}

const source = readFileSync(contractPath, "utf8");

interface SolcInput {
  language: "Solidity";
  sources: Record<string, { content: string }>;
  settings: {
    optimizer: { enabled: boolean; runs: number };
    outputSelection: Record<string, Record<string, string[]>>;
    viaIR: boolean;
  };
}

interface SolcError {
  type?: string;
  severity: "error" | "warning" | "info";
  formattedMessage: string;
}

interface SolcContract {
  abi: unknown[];
  evm: { bytecode: { object: string } };
}

interface SolcOutput {
  errors?: SolcError[];
  contracts?: Record<string, Record<string, SolcContract>>;
}

const input: SolcInput = {
  language: "Solidity",
  sources: {
    "MockFCFSMint.sol": { content: source },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: false,
    outputSelection: {
      "*": { "*": ["abi", "evm.bytecode.object"] },
    },
  },
};

function findImport(path: string): SolcImportResult {
  // Resolve OpenZeppelin imports against node_modules.
  const candidates = [
    resolve(root, "node_modules", path),
    resolve(root, path),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return { contents: readFileSync(c, "utf8") };
  }
  return { error: `File not found: ${path}` };
}

console.log(`Compiling with solc ${solc.version()}...`);
const output: SolcOutput = JSON.parse(
  solc.compile(JSON.stringify(input), { import: findImport }),
);

let hadError = false;
for (const err of output.errors ?? []) {
  if (err.severity === "error") hadError = true;
  process.stderr.write(`${err.formattedMessage}\n`);
}
if (hadError) {
  throw new Error("Solidity compilation failed");
}

const contract = output.contracts?.["MockFCFSMint.sol"]?.["MockFCFSMint"];
if (!contract) {
  throw new Error("MockFCFSMint not found in compiler output");
}

const artifact = {
  contractName: "MockFCFSMint",
  abi: contract.abi,
  bytecode: `0x${contract.evm.bytecode.object}`,
  compiledAt: new Date().toISOString(),
  solcVersion: solc.version(),
};

writeFileSync(outPath, JSON.stringify(artifact, null, 2));
console.log(`Wrote ${outPath}`);
console.log(`  bytecode size: ${(contract.evm.bytecode.object.length / 2).toLocaleString()} bytes`);
console.log(`  abi entries:   ${contract.abi.length}`);
