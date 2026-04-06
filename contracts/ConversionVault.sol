// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./tokens/VotesToken.sol";

/**
 * @title ConversionVault
 * @notice Convert BRIBE or CORUPT tokens to VOTES at fixed rate
 * @dev Rate: 100 BRIBE/CORUPT = 1 VOTES
 */
contract ConversionVault is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Conversion rate: 100:1 (100 input tokens = 1 VOTES)
    uint256 public constant CONVERSION_RATE = 100;
    
    ERC20Burnable public immutable bribeToken;
    ERC20Burnable public immutable coruptToken;
    VotesToken public immutable votesToken;

    // Conversion stats
    uint256 public totalBribeBurned;
    uint256 public totalCoruptBurned;
    uint256 public totalVotesMinted;

    event Converted(
        address indexed user,
        address indexed inputToken,
        uint256 inputAmount,
        uint256 votesReceived
    );

    constructor(
        address admin,
        address _bribeToken,
        address _coruptToken,
        address _votesToken
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        
        bribeToken = ERC20Burnable(_bribeToken);
        coruptToken = ERC20Burnable(_coruptToken);
        votesToken = VotesToken(_votesToken);
    }

    /**
     * @notice Convert BRIBE tokens to VOTES
     * @param amount Amount of BRIBE to convert (must be multiple of 100)
     */
    function convertBribe(uint256 amount) external nonReentrant returns (uint256 votesAmount) {
        require(amount > 0, "Zero amount");
        require(amount >= CONVERSION_RATE, "Minimum 100 tokens");
        
        votesAmount = amount / CONVERSION_RATE;
        uint256 actualBurn = votesAmount * CONVERSION_RATE;
        
        // Transfer and burn BRIBE
        IERC20(address(bribeToken)).safeTransferFrom(msg.sender, address(this), actualBurn);
        bribeToken.burn(actualBurn);
        
        // Mint VOTES
        votesToken.mintFromConversion(msg.sender, votesAmount);
        
        totalBribeBurned += actualBurn;
        totalVotesMinted += votesAmount;
        
        emit Converted(msg.sender, address(bribeToken), actualBurn, votesAmount);
        
        return votesAmount;
    }

    /**
     * @notice Convert CORUPT tokens to VOTES
     * @param amount Amount of CORUPT to convert (must be multiple of 100)
     */
    function convertCorupt(uint256 amount) external nonReentrant returns (uint256 votesAmount) {
        require(amount > 0, "Zero amount");
        require(amount >= CONVERSION_RATE, "Minimum 100 tokens");
        
        votesAmount = amount / CONVERSION_RATE;
        uint256 actualBurn = votesAmount * CONVERSION_RATE;
        
        // Transfer and burn CORUPT
        IERC20(address(coruptToken)).safeTransferFrom(msg.sender, address(this), actualBurn);
        coruptToken.burn(actualBurn);
        
        // Mint VOTES
        votesToken.mintFromConversion(msg.sender, votesAmount);
        
        totalCoruptBurned += actualBurn;
        totalVotesMinted += votesAmount;
        
        emit Converted(msg.sender, address(coruptToken), actualBurn, votesAmount);
        
        return votesAmount;
    }

    /**
     * @notice Calculate VOTES output for given input amount
     */
    function calculateVotesOutput(uint256 inputAmount) external pure returns (uint256) {
        return inputAmount / CONVERSION_RATE;
    }

    /**
     * @notice Get conversion stats
     */
    function getStats() external view returns (
        uint256 bribeBurned,
        uint256 coruptBurned,
        uint256 votesMinted
    ) {
        return (totalBribeBurned, totalCoruptBurned, totalVotesMinted);
    }
}
