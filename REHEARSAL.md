# Sepolia Rehearsal Walkthrough

Goal: prove the bot fires correctly **before** you spend real money on a
mainnet drop. Total time: ~30 minutes including faucet drip.

You will:

1. Deploy a mock FCFS NFT contract to Sepolia.
2. Point the bot at it.
3. Trigger the mint and inspect timing/inclusion.
4. Tune `LEAD_TIME_MS` and `TIP_LADDER_GWEI` based on what you see.
5. Repeat until the bot reliably mints in the activation block.

---

## 0. Pre-requisites

- Node.js 20+
- A throw-away private key (do **not** reuse a mainnet wallet)
- Some Sepolia ETH from a faucet:
  - https://sepoliafaucet.com
  - https://www.alchemy.com/faucets/ethereum-sepolia
- An Alchemy or Infura Sepolia API key (free tier is fine)

```bash
unzip nft-mint-bot.zip && cd nft-mint-bot
npm install
cp .env.sepolia.example .env
$EDITOR .env       # fill PRIVATE_KEY + RPC_URLS
```

## 1. Compile the mock contract

```bash
npm run compile-mock
```

Expected:

```
Compiling with solc 0.8.35+...
Wrote scripts/mockFcfsMint.compiled.json
  bytecode size: 6,543 bytes
  abi entries:   44
```

The `mockFcfsMint.compiled.json` artifact is committed alongside the
contract source so you can re-deploy without re-installing solc.

## 2. Deploy to Sepolia

```bash
npm run deploy-mock
```

Expected output ends with:

```
contract      0xABC...123
NFT_CONTRACT=0xABC...123
MINT_TIMESTAMP=1716471600
MINT_VALUE_WEI=10000000000000000
MINT_FUNCTION=mint
MINT_ARGS=[1]
```

Copy those four lines into your `.env`, replacing the placeholder values.
The mint will open **5 minutes from now** by default; bump `MOCK_MINT_START`
in your `.env` if you need more lead time.

You can also verify the contract source on Sepolia Etherscan to make `eth_call`
simulations human-readable:

```bash
# Optional - if you have an Etherscan API key
npx hardhat verify --network sepolia 0xABC...123 \
  "RehearsalNFT" "REHRSE" 100 10000000000000000 1716471600 5
```

## 3. Dry-run the bot (no broadcast)

```bash
npm run simulate
```

Expected:

```
[+    62.6ms] chain=Sepolia (11155111)  account=0x...
[+    62.8ms] contract=0xABC...123  fn=mint  value=0.01 ETH
[+    62.9ms] mode=public  rpcs=2  ws=yes
[+   338.0ms] balance=0.05 ETH
[+   843.7ms] startNonce=0
[+   845.5ms] calldata=0xa0712d68... (36 bytes)
[+   850.4ms] pre-signed tx #0  nonce=0  tip=2 gwei  size=86B (unsigned)
[+   853.5ms] pre-signed tx #1  nonce=1  tip=5 gwei  size=86B (unsigned)
[+   855.7ms] pre-signed tx #2  nonce=2  tip=10 gwei  size=86B (unsigned)
[+   855.8ms] --dry-run set - exiting before broadcast
```

If simulation reverts, double-check `MINT_VALUE_WEI` matches `MOCK_MINT_PRICE_WEI`
and `MINT_TIMESTAMP` matches the contract's `MINT_START`.

## 4. Real run

```bash
npm start
```

The bot will:

1. Fetch nonce, balance, simulate.
2. Pre-sign the tip ladder.
3. Wait until `MINT_TIMESTAMP - LEAD_TIME_MS`.
4. Broadcast through whichever `PRIVATE_TX_MODE` you configured.

Watch the output. Useful timing markers:

```
[+10000ms] FIRE  targetBlock=5712345
[+10042ms] public tx 0 hash=0xdeadbeef...
[+10058ms] public tx 1 hash=0xbeefcafe...
[+10073ms] public tx 2 hash=0xcafedead...
```

Then look up each hash on https://sepolia.etherscan.io to see:

- Was it included in the activation block, or one block later?
- Did `mint(uint256)` revert with `MintNotStarted`?
- What was the actual gas cost?

## 5. Tuning loop

Run the rehearsal **at least 3 times** and adjust:

| Symptom                                       | Fix                                                              |
|-----------------------------------------------|-------------------------------------------------------------------|
| `MintNotStarted` revert                       | Reduce `LEAD_TIME_MS` (firing too early)                          |
| Tx lands 1 block late                         | Increase `LEAD_TIME_MS`, add lower-latency RPC, or move VPS region|
| Only the highest-tip tx mints                 | Drop the lower tip rungs; not worth the gas for failed tx         |
| All three tx mint (oversubscribed)            | Set `MAX_PER_WALLET` higher in your bot logic, or tweak nonces    |
| Sim says revert but contract is fine          | `REQUIRE_SIM=0` *only* if you understand why (e.g. timestamp gating) |

Track each run in a notebook:

```
run #1: leadTime=400ms, tip=[2,5,10], result=tx1 included @block+1, tx2 reverted MintNotStarted
run #2: leadTime=600ms, tip=[5,10,20], result=tx0 included @block+0 (ACTIVATION)
```

Stop when you can hit the activation block 3 times in a row.

## 6. Switch to mainnet

Once the rehearsal is solid:

```bash
cp .env .env.sepolia.last       # archive the working settings
cp .env.example .env             # start from the mainnet template
```

Copy over only the values that translate (RPC region, LEAD_TIME_MS, tip
ladder shape). Set:

```env
CHAIN=mainnet
PRIVATE_TX_MODE=protect
MAX_FEE_PER_GAS_GWEI=...    # check current basefee, double it
PRIORITY_FEE_GWEI=...        # 5-15 gwei is competitive
NFT_CONTRACT=...             # the real drop's address
MINT_TIMESTAMP=...           # the real drop's timestamp
```

Then run `npm run simulate` one last time on mainnet (it just reads chain
state, no broadcast) and `npm start` at T-30 minutes.

## 7. Post-mint

After a successful mainnet mint:

1. Sweep the NFT to a cold wallet immediately:
   ```bash
   cast send $NFT_CONTRACT "safeTransferFrom(address,address,uint256)" \
     $HOT_WALLET $COLD_WALLET $TOKEN_ID --private-key $PRIVATE_KEY
   ```
2. Withdraw any leftover gas from the hot wallet.
3. Rotate the private key — never reuse a hot mint wallet.
