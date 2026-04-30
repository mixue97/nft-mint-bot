/**
 * Default ABI fragments used to encode mint calldata.
 *
 * Add the exact signature of your target contract's mint function here, OR
 * drop the verified contract's full ABI in `MINT_ABI_PATH` (see config.ts).
 */
export const DEFAULT_MINT_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "payable",
    inputs: [{ name: "quantity", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "publicMint",
    stateMutability: "payable",
    inputs: [{ name: "quantity", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "payable",
    inputs: [
      { name: "receiver", type: "address" },
      { name: "quantity", type: "uint256" },
      { name: "currency", type: "address" },
      { name: "pricePerToken", type: "uint256" },
      {
        name: "allowlistProof",
        type: "tuple",
        components: [
          { name: "proof", type: "bytes32[]" },
          { name: "quantityLimitPerWallet", type: "uint256" },
          { name: "pricePerToken", type: "uint256" },
          { name: "currency", type: "address" },
        ],
      },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "mintWithProof",
    stateMutability: "payable",
    inputs: [
      { name: "proof", type: "bytes32[]" },
      { name: "quantity", type: "uint256" },
    ],
    outputs: [],
  },
] as const;
