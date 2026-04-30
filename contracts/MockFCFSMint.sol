// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockFCFSMint
 * @notice Minimal first-come-first-served ERC721 used to rehearse the
 *         nft-mint-bot on Sepolia / Holesky / Base Sepolia.
 *
 *         Mechanics:
 *           - Hard supply cap (`MAX_SUPPLY`)
 *           - Mint opens at `MINT_START` (unix seconds)
 *           - Per-wallet cap (`MAX_PER_WALLET`)
 *           - Fixed price per token (`MINT_PRICE`, in wei)
 *           - Owner can withdraw collected ETH for cleanup
 *
 *         All revert reasons use custom errors so the bot's `eth_call`
 *         simulator gets readable failure messages.
 */
contract MockFCFSMint is ERC721, Ownable {
    uint256 public immutable MAX_SUPPLY;
    uint256 public immutable MINT_PRICE;
    uint256 public immutable MINT_START;
    uint256 public immutable MAX_PER_WALLET;

    uint256 public totalSupply;
    mapping(address => uint256) public mintedPerWallet;

    error MintNotStarted(uint256 nowTs, uint256 startTs);
    error SoldOut(uint256 minted, uint256 supply);
    error WrongPayment(uint256 sent, uint256 expected);
    error WalletCapReached(uint256 minted, uint256 cap);

    event Minted(address indexed to, uint256 indexed startTokenId, uint256 quantity);

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 maxSupply_,
        uint256 mintPrice_,
        uint256 mintStart_,
        uint256 maxPerWallet_
    ) ERC721(name_, symbol_) Ownable(msg.sender) {
        MAX_SUPPLY = maxSupply_;
        MINT_PRICE = mintPrice_;
        MINT_START = mintStart_;
        MAX_PER_WALLET = maxPerWallet_;
    }

    function mint(uint256 quantity) external payable {
        if (block.timestamp < MINT_START) {
            revert MintNotStarted(block.timestamp, MINT_START);
        }
        if (totalSupply + quantity > MAX_SUPPLY) {
            revert SoldOut(totalSupply, MAX_SUPPLY);
        }
        uint256 expectedPayment = MINT_PRICE * quantity;
        if (msg.value != expectedPayment) {
            revert WrongPayment(msg.value, expectedPayment);
        }
        uint256 walletMinted = mintedPerWallet[msg.sender];
        if (walletMinted + quantity > MAX_PER_WALLET) {
            revert WalletCapReached(walletMinted, MAX_PER_WALLET);
        }

        mintedPerWallet[msg.sender] = walletMinted + quantity;
        uint256 startTokenId = totalSupply + 1;

        for (uint256 i; i < quantity; ++i) {
            unchecked {
                ++totalSupply;
            }
            _safeMint(msg.sender, totalSupply);
        }

        emit Minted(msg.sender, startTokenId, quantity);
    }

    function withdraw(address payable to) external onlyOwner {
        (bool ok, ) = to.call{value: address(this).balance}("");
        require(ok, "withdraw failed");
    }
}
