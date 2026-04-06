// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IAMM.sol";
import "./interfaces/IEpochManager.sol";

/**
 * @title TaxController
 * @notice Orchestrates swaps and collects/distributes taxes
 * @dev Tax distribution: 71% staking, 24% carnage fund, 5% treasury
 */
contract TaxController is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // Tax distribution percentages (in basis points)
    uint256 public constant STAKING_SHARE_BPS = 7100;    // 71%
    uint256 public constant CARNAGE_SHARE_BPS = 2400;    // 24%
    uint256 public constant TREASURY_SHARE_BPS = 500;    // 5%
    uint256 public constant BPS_DENOMINATOR = 10000;

    // Slippage protection (50% minimum output)
    uint256 public constant MIN_OUTPUT_BPS = 5000;

    IAMM public amm;
    IEpochManager public epochManager;
    
    address public stakingContract;
    address public carnageFund;
    address public treasury;
    address public usdc;

    // Accumulated fees for distribution
    uint256 public pendingStakingFees;
    uint256 public pendingCarnageFees;
    uint256 public pendingTreasuryFees;

    event SwapExecuted(
        address indexed user,
        bytes32 indexed poolId,
        address tokenIn,
        uint256 amountIn,
        uint256 amountOut,
        uint256 taxAmount
    );
    event FeesDistributed(uint256 staking, uint256 carnage, uint256 treasury);
    event TaxCollected(uint256 amount, uint256 taxRateBps);

    constructor(
        address admin,
        address _amm,
        address _epochManager,
        address _usdc
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        
        amm = IAMM(_amm);
        epochManager = IEpochManager(_epochManager);
        usdc = _usdc;
    }

    function setAddresses(
        address _stakingContract,
        address _carnageFund,
        address _treasury
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        stakingContract = _stakingContract;
        carnageFund = _carnageFund;
        treasury = _treasury;
    }

    /**
     * @notice Execute a taxed swap
     * @param poolId The pool to swap in
     * @param tokenIn Token being sold
     * @param amountIn Amount of tokenIn
     * @param minAmountOut Minimum output (slippage protection)
     */
    function swap(
        bytes32 poolId,
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut
    ) external nonReentrant returns (uint256 amountOut) {
        require(amountIn > 0, "Zero amount");
        
        // Get current tax rate from epoch manager
        uint256 taxRateBps = epochManager.getCurrentTaxRate();
        
        // Calculate tax
        uint256 taxAmount = (amountIn * taxRateBps) / BPS_DENOMINATOR;
        uint256 amountAfterTax = amountIn - taxAmount;
        
        // Transfer tokens from user
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        
        // Approve AMM for swap
        IERC20(tokenIn).approve(address(amm), amountAfterTax);
        
        // Execute swap with remaining amount
        amountOut = amm.swapExactInput(
            poolId,
            tokenIn,
            amountAfterTax,
            minAmountOut,
            msg.sender
        );
        
        // Distribute tax
        if (taxAmount > 0) {
            _distributeTax(tokenIn, taxAmount);
        }
        
        emit SwapExecuted(msg.sender, poolId, tokenIn, amountIn, amountOut, taxAmount);
        emit TaxCollected(taxAmount, taxRateBps);
        
        return amountOut;
    }

    /**
     * @dev Internal tax distribution
     */
    function _distributeTax(address token, uint256 amount) internal {
        uint256 stakingAmount = (amount * STAKING_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 carnageAmount = (amount * CARNAGE_SHARE_BPS) / BPS_DENOMINATOR;
        uint256 treasuryAmount = amount - stakingAmount - carnageAmount;
        
        // Transfer to respective addresses
        if (stakingContract != address(0) && stakingAmount > 0) {
            IERC20(token).safeTransfer(stakingContract, stakingAmount);
        }
        
        if (carnageFund != address(0) && carnageAmount > 0) {
            IERC20(token).safeTransfer(carnageFund, carnageAmount);
        }
        
        if (treasury != address(0) && treasuryAmount > 0) {
            IERC20(token).safeTransfer(treasury, treasuryAmount);
        }
        
        emit FeesDistributed(stakingAmount, carnageAmount, treasuryAmount);
    }

    /**
     * @notice Get quote including tax
     */
    function getSwapQuote(
        bytes32 poolId,
        address tokenIn,
        uint256 amountIn
    ) external view returns (uint256 amountOut, uint256 taxAmount) {
        uint256 taxRateBps = epochManager.getCurrentTaxRate();
        taxAmount = (amountIn * taxRateBps) / BPS_DENOMINATOR;
        uint256 amountAfterTax = amountIn - taxAmount;
        
        amountOut = amm.getAmountOut(poolId, tokenIn, amountAfterTax);
        
        return (amountOut, taxAmount);
    }
}
