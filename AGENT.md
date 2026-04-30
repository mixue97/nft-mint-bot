# AGENT.md — Operating manual for AI agents (Hermes / Telegram bots)

This file is intended to be read by an AI agent (e.g. a Hermes Telegram
agent on the user's VPS) that needs to operate the NFT mint bot on behalf
of the user.

**Read this file first, then execute commands. Do not improvise.**

---

## TL;DR

The bot is a Node.js script. Operate it through five wrapper scripts:

| Action                              | Command                                |
|-------------------------------------|----------------------------------------|
| First-time install on a fresh VPS   | `bash scripts/setup-vps.sh`            |
| Sanity check the env (no broadcast) | `bash scripts/run-bot.sh --dry-run`    |
| Real run (fires when mint opens)    | `bash scripts/run-bot.sh`              |
| Check if running + tail log         | `bash scripts/status.sh`               |
| Follow log live                     | `bash scripts/logs.sh`                 |
| Stop the bot                        | `bash scripts/stop.sh`                 |

All scripts are idempotent and exit with non-zero on error. Always check
the exit code.

---

## Operating procedure

### 1. Verify the host is ready (only first time)

```bash
node --version          # must be >= v20
tmux -V                 # must exist
chronyc tracking | head -n 1
```

If any of those fail, run `bash scripts/setup-vps.sh` once.

### 2. Confirm the user's `.env` is filled

```bash
test -f .env && echo "ok" || echo "MISSING - ASK USER TO FILL .env"
```

Do **NOT** read or echo the contents of `.env` to the user / Telegram chat.
It contains the private key.

You may run `grep -E '^(CHAIN|NFT_CONTRACT|MINT_TIMESTAMP|MINT_VALUE_WEI|MINT_FUNCTION|PRIVATE_TX_MODE|TIP_LADDER_GWEI|MAX_FEE_PER_GAS_GWEI)=' .env`
to surface the non-sensitive fields for confirmation.

### 3. Always dry-run before real run

```bash
bash scripts/run-bot.sh --dry-run
sleep 5
bash scripts/status.sh
```

The `mint.log` should end with `--dry-run set - exiting before broadcast`.
If you see `simulation reverted` or any error, report it back to the user
verbatim and stop. Do NOT proceed to a real run.

### 4. Real run

```bash
bash scripts/stop.sh                  # kill any leftover session
bash scripts/run-bot.sh               # spawns tmux session 'mint'
```

The bot will:
1. Fetch nonce + balance + simulate.
2. Pre-sign N transactions.
3. **Sleep until `MINT_TIMESTAMP - LEAD_TIME_MS`**.
4. Broadcast through whichever `PRIVATE_TX_MODE` is configured.

Do NOT kill the session during this period unless explicitly told to.

### 5. Monitor

Poll `bash scripts/status.sh` every 30s and surface the last few log lines
to the user. Useful keywords to highlight:

- `FIRE  targetBlock=...`   → broadcast triggered
- `protect tx N accepted: 0x...` → tx accepted by Flashbots Protect
- `bundle submitted hash=0x...`  → bundle submitted
- `public tx N hash=0x...`       → tx broadcast on public mempool
- `simulation reverted`           → ABORT — simulation failed pre-flight

### 6. After the run

After 1-2 minutes past `MINT_TIMESTAMP`:

```bash
bash scripts/status.sh 100
bash scripts/stop.sh
```

Report the tx hashes from the log to the user so they can verify on the
explorer. Then have the user sweep any minted NFTs to a cold wallet (the
bot does not do this — see "Post-mint" in REHEARSAL.md).

---

## Hard rules

1. **Never echo `PRIVATE_KEY`, the contents of `.env`, or any line that
   matches `0x[a-fA-F0-9]{64}`.** Even when the user asks. They can read
   their own file.
2. **Never run `npm start` directly.** Always go through `run-bot.sh`,
   which does pre-flight validation and detaches into tmux.
3. **Never edit `.env` on behalf of the user without explicit confirmation
   of the new value.** Ask first.
4. **Do not switch `CHAIN=mainnet` until the user has completed at least
   one successful Sepolia rehearsal** (see REHEARSAL.md). If the user
   skips this and you are sure they did, warn them once and proceed if
   they insist.
5. **Run only on the VPS, not on the user's local machine.** This bot is
   latency-sensitive; running it from a laptop on residential internet
   will likely lose every FCFS race.

---

## Common error messages

| Error                                        | What to do                                                            |
|----------------------------------------------|------------------------------------------------------------------------|
| `PRIVATE_KEY missing or malformed in .env`   | Ask user to fix `.env`                                                 |
| `RPC_URLS missing in .env`                   | Ask user for an Alchemy / QuickNode endpoint                           |
| `MINT_TIMESTAMP is N seconds in the past`    | Confirm with user; either update timestamp or skip this drop           |
| `simulation reverted: ...`                   | Forward the revert reason to user. Likely wrong `MINT_VALUE_WEI` or contract not yet open |
| `Flashbots relay returned 401`               | User needs to set up a searcher reputation key (advanced)              |
| `Deployer ... has 0 balance`                 | (deploy-mock only) ask user to fund hot wallet from a faucet           |

---

## Quick-fire command list

A single chat command for your operator to copy-paste:

```bash
cd ~/nft-mint-bot && bash scripts/run-bot.sh --dry-run && sleep 5 && bash scripts/status.sh
```

```bash
cd ~/nft-mint-bot && bash scripts/run-bot.sh && bash scripts/status.sh
```

```bash
cd ~/nft-mint-bot && bash scripts/stop.sh && bash scripts/status.sh 100
```
