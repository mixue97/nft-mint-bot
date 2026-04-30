# nft-mint-bot

A starter NFT minting bot in **TypeScript + viem + Flashbots**, designed for
First-Come-First-Served (FCFS) drops on EVM chains.

It automates the playbook from
[@Zun2025's thread on FCFS minting](https://threadreaderapp.com/thread/1900525111243055160.html):

- mint **directly** through the contract instead of the dApp UI
- pre-encode calldata & pre-sign transactions before mint time
- broadcast through a **private mempool** (Flashbots Protect / `eth_sendBundle`)
  to avoid front-running
- fan out a **tip ladder** of transactions with rising priority fees
- race **multiple paid RPC endpoints** for the lowest broadcast latency

---

## Features

| File                      | Responsibility                                                                |
|---------------------------|--------------------------------------------------------------------------------|
| `src/config.ts`           | Type-safe `.env` loader with sane defaults                                     |
| `src/wallet.ts`           | viem account + monotonically increasing nonce allocator                        |
| `src/rpc.ts`              | Multi-URL public client + parallel RPC racer + WebSocket subscription          |
| `src/calldata.ts`         | Encode mint calldata once, ahead of mint time                                  |
| `src/simulator.ts`        | `eth_call` + `eth_estimateGas` dry-run to refuse broadcasting reverting tx     |
| `src/trigger.ts`          | NTP-driven scheduler with `newHeads` fallback; fires `leadTimeMs` before drop  |
| `src/flashbots.ts`        | `eth_sendBundle` to the Flashbots relay **and** Flashbots Protect RPC mode     |
| `src/index.ts`            | Orchestration: pre-flight, pre-sign tip ladder, wait, broadcast, monitor       |
| `contracts/MockFCFSMint.sol` | Test ERC721 with FCFS, supply cap, mintStart, per-wallet limit              |
| `scripts/compileMock.ts`  | Compile the test contract with solc-js                                         |
| `scripts/deployMock.ts`   | Deploy the test contract to Sepolia/Holesky/etc via viem                       |
| `scripts/setup-vps.sh`    | One-shot install of Node 20, tmux, chrony on a fresh Debian/Ubuntu VPS         |
| `scripts/run-bot.sh`      | Validate `.env`, archive old log, launch bot in detached tmux session          |
| `scripts/status.sh`       | Report tmux session state + tail last N log lines                              |
| `scripts/logs.sh`         | Follow `mint.log` live (`tail -F`)                                             |
| `scripts/stop.sh`         | Kill the tmux session                                                          |
| `AGENT.md`                | Operating manual for AI agents (Hermes / Telegram bots) running the bot        |

## Quick start

```bash
git clone <this repo>
cd nft-mint-bot
npm install
cp .env.example .env       # then fill PRIVATE_KEY, RPC_URLS, NFT_CONTRACT, MINT_TIMESTAMP

npm run typecheck          # sanity check
npm run simulate           # dry-run: builds calldata, fetches nonce, pre-signs, exits
npm start                  # real run
```

### Operating on a VPS (recommended)

For a real mint, you want this running on a low-latency VPS, not your laptop.
The repo ships with helper scripts for first-time setup and tmux-based
launch / monitor / stop:

```bash
# one-shot install on a fresh VPS (Debian / Ubuntu) - installs Node 20, tmux, chrony
npm run setup

# fire the bot in a detached tmux session
npm run run-bot                # real run
npm run run-bot -- --dry-run   # safe dry-run

# inspect / stop
npm run status                 # quick status + last 30 log lines
npm run logs                   # follow mint.log live
npm run stop                   # kill the tmux session
```

If you have a Telegram-connected agent (Hermes, etc.) operating the VPS,
have it read [`AGENT.md`](./AGENT.md) first — it documents the exact
operating procedure and hard rules (e.g. "never echo `PRIVATE_KEY`").

**Don't run on mainnet without a Sepolia rehearsal first.** See
[`REHEARSAL.md`](./REHEARSAL.md) for a 30-minute walkthrough that deploys a
mock FCFS contract to Sepolia and tunes `LEAD_TIME_MS` / `TIP_LADDER_GWEI`
against your VPS's real latency.

```bash
cp .env.sepolia.example .env
npm run compile-mock       # solc -> scripts/mockFcfsMint.compiled.json
npm run deploy-mock        # deploys MockFCFSMint.sol to Sepolia
# ...follow REHEARSAL.md
```

## Configuration

All knobs live in `.env`. See `.env.example` for the full list; the most
important ones:

```env
PRIVATE_KEY=0x...                 # hot wallet (only enough $ for gas + mint price)
CHAIN=mainnet                     # mainnet | sepolia | base | arbitrum | optimism | polygon | bsc
RPC_URLS=https://...,https://...  # 2-5 paid endpoints, comma-separated
WS_URL=wss://...                  # optional, enables newHeads-driven trigger

PRIVATE_TX_MODE=protect           # protect | bundle | public
NFT_CONTRACT=0xabc...
MINT_FUNCTION=mint
MINT_ARGS=[1]                     # JSON array - matches the function signature
MINT_VALUE_WEI=50000000000000000  # 0.05 ETH

MINT_TIMESTAMP=1716471600         # unix epoch seconds the contract opens
LEAD_TIME_MS=400                  # fire 400ms early to compensate for broadcast RTT

MAX_FEE_PER_GAS_GWEI=50
TIP_LADDER_GWEI=5,15,30           # one tx per tip, rising priority fees
```

### Picking a `PRIVATE_TX_MODE`

| Mode      | Use when                                                                        |
|-----------|---------------------------------------------------------------------------------|
| `protect` | Ethereum mainnet, simplest setup. Sends one tx through Flashbots Protect RPC.   |
| `bundle`  | You want full bundle control & multiple tx per block via `eth_sendBundle`.      |
| `public`  | L2s without a public mempool (Arbitrum / Base / OP) or for testing.             |

### Custom ABIs

If your contract's mint function isn't covered by `src/abi.ts`, set:

```env
MINT_ABI_PATH=./mint-abi.json     # full ABI from Etherscan, or { "abi": [...] }
MINT_FUNCTION=customMintName
MINT_ARGS=[["0xproof1","0xproof2"], 1, "0xrecipient"]
```

For unverified contracts, capture the HEX calldata from your wallet popup
(via the Time Traveller Chrome extension) and pass it directly:

```env
RAW_CALLDATA=0xa0712d680000000000000000000000000000000000000000000000000000000000000001
```

## How it works

```
                 ┌───────────────────────────────────────┐
                 │         loadConfig (config.ts)        │
                 └────────────────┬──────────────────────┘
                                  │
     ┌────────────────────────────┼─────────────────────────────┐
     │                            │                             │
┌────▼────┐               ┌───────▼──────┐               ┌─────▼─────┐
│ buildRpcPool │           │ buildSigner │               │ buildCalldata │
│ (rpc.ts)    │            │ (wallet.ts)│               │ (calldata.ts) │
└────┬────────┘            └──────┬─────┘               └─────┬─────────┘
     │                            │                           │
     │   getBalance / nonce       │                           │
     ├────────────────────────────►                           │
     │                            │                           │
     │           simulateMint (simulator.ts)                  │
     ◄────────────────────────────┴───────────────────────────┘
                                  │
                       Pre-sign N tx (tip ladder)
                                  │
                       waitForTrigger (trigger.ts)
                                  │
            ┌─────────────────────┼─────────────────────┐
            │                     │                     │
    sendProtectTx          sendBundle (Flashbots)  sendRawTransaction
   (mode=protect)            (mode=bundle)           (mode=public)
            │                     │                     │
            ▼                     ▼                     ▼
                       Wait for receipts / log
```

## Operational tips

1. **Latency is everything.** Run on a VPS in `us-east-1` (Virginia) or
   `eu-central` (Frankfurt). Target <30 ms RTT to your RPC.
2. **NTP-sync your server.** Install `chrony`; off-clock by a few hundred ms
   is the difference between the activation block and the next.
3. **Pay for an RPC.** Public RPCs are rate-limited and slow. Alchemy /
   QuickNode / dRPC paid tiers all work.
4. **Test on Sepolia first.** Deploy a clone of the target contract,
   run the bot end-to-end, measure broadcast latency.
5. **Use a fresh hot wallet** with only enough native token for gas + mint
   price. Sweep NFTs to a cold wallet immediately after mint.
6. **Add a sweeper.** A separate script that watches your hot wallet and
   `safeTransferFrom`s any new NFT to a cold address.

## What this is NOT

- Not a sniping bot for arbitrary contracts; it targets one drop at a time.
- Not multi-wallet by default (most projects allow-list per wallet anyway).
- Not "magic" - if the project uses a signature allow-list, server-side
  rate-limit, or recaptcha, you still need to obtain the signature/proof
  out-of-band.

## Risks

- Failed mint transactions still cost gas. Set `MAX_FEE_PER_GAS_GWEI` carefully.
- Flashbots bundles are best-effort; they can be dropped or out-bid.
- Some L2s order by sequencer FIFO, not by priority fee, so the tip ladder is
  not useful there - use a single tx and minimise broadcast latency.
- Many projects detect bot behaviour and may blacklist or refund. Always
  read the project's mint mechanic before running.

## License

MIT
