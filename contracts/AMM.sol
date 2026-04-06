// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AMM
 * @notice Constant product AMM for BRIBE/USDC and CORUPT/USDC pools
 * @dev Protocol-owned liquidity, no LP tokens issued
 */
contract AMM is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant POOL_MANAGER_ROLE = keccak256("POOL_MANAGER_ROLE");
    bytes32 public constant TAX_CONTROLLER_ROLE = keccak256("TAX_CONTROLLER_ROLE");

    struct Pool {
        address tokenA;      // Protocol token (BRIBE or CORUPT)
        address tokenB;      // USDC
        uint256 reserveA;
        uint256 reserveB;
        bool active;
    }

    // Pool ID => Pool
    mapping(bytes32 => Pool) public pools;
    
    // LP fee in basis points (100 = 1%)
    uint256 public constant LP_FEE_BPS = 100;
    uint256 public constant BPS_DENOMINATOR = 10000;

    // Known pool IDs
    bytes32 public immutable BRIBE_POOL_ID;
    bytes32 public immutable CORUPT_POOL_ID;

    address public immutable usdc;
    address public taxController;

    event PoolCreated(bytes32 indexed poolId, address tokenA, address tokenB);
    event LiquidityAdded(bytes32 indexed poolId, uint256 amountA, uint256 amountB);
    event LiquidityRemoved(bytes32 indexed poolId, uint256 amountA, uint256 amountB);
    event Swap(
        bytes32 indexed poolId,
        address indexed user,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee
    );

    constructor(
        address admin,
        address _usdc,
        address bribeToken,
        address coruptToken
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(POOL_MANAGER_ROLE, admin);
        
        usdc = _usdc;
        
        // Create pool IDs
        BRIBE_POOL_ID = keccak256(abi.encodePacked(bribeToken, _usdc));
        CORUPT_POOL_ID = keccak256(abi.encodePacked(coruptToken, _usdc));
        
        // Initialize pools
        pools[BRIBE_POOL_ID] = Pool({
            tokenA: bribeToken,
            tokenB: _usdc,
            reserveA: 0,
            reserveB: 0,
            active: true
        });
        
        pools[CORUPT_POOL_ID] = Pool({
            tokenA: coruptToken,
            tokenB: _usdc,
            reserveA: 0,
            reserveB: 0,
            active: true
        });
        
        emit PoolCreated(BRIBE_POOL_ID, bribeToken, _usdc);
        emit PoolCreated(CORUPT_POOL_ID, coruptToken, _usdc);
    }

    function setTaxController(address _taxController) external onlyRole(DEFAULT_ADMIN_ROLE) {
        taxController = _taxController;
        _grantRole(TAX_CONTROLLER_ROLE, _taxController);
    }

    /**
     * @notice Add liquidity to a pool (protocol-only)
     */
    function addLiquidity(
        bytes32 poolId,
        uint256 amountA,
        uint256 amountB
    ) external onlyRole(POOL_MANAGER_ROLE) nonReentrant {
        Pool storage pool = pools[poolId];
        require(pool.active, "Pool not active");
        
        IERC20(pool.tokenA).safeTransferFrom(msg.sender, address(this), amountA);
        IERC20(pool.tokenB).safeTransferFrom(msg.sender, address(this), amountB);
        
        pool.reserveA += amountA;
        pool.reserveB += amountB;
        
        emit LiquidityAdded(poolId, amountA, amountB);
    }

    /**
     * @notice Remove liquidity from a pool (protocol-only)
     */
    function removeLiquidity(
        bytes32 poolId,
        uint256 amountA,
        uint256 amountB
    ) external onlyRole(POOL_MANAGER_ROLE) nonReentrant {
        Pool storage pool = pools[poolId];
        require(pool.reserveA >= amountA && pool.reserveB >= amountB, "Insufficient reserves");
        
        pool.reserveA -= amountA;
        pool.reserveB -= amountB;
        
        IERC20(pool.tokenA).safeTransfer(msg.sender, amountA);
        IERC20(pool.tokenB).safeTransfer(msg.sender, amountB);
        
        emit LiquidityRemoved(poolId, amountA, amountB);
    }

    /**
     * @notice Execute a swap through TaxController
     * @dev Only callable by TaxController for tax collection
     */
    function swapExactInput(
        bytes32 poolId,
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external onlyRole(TAX_CONTROLLER_ROLE) nonReentrant returns (uint256 amountOut) {
        Pool storage pool = pools[poolId];
        require(pool.active, "Pool not active");
        require(tokenIn == pool.tokenA || tokenIn == pool.tokenB, "Invalid token");
        
        bool isAtoB = tokenIn == pool.tokenA;
        
        (uint256 reserveIn, uint256 reserveOut) = isAtoB 
            ? (pool.reserveA, pool.reserveB) 
            : (pool.reserveB, pool.reserveA);
        
        // Calculate output with LP fee
        uint256 amountInWithFee = amountIn * (BPS_DENOMINATOR - LP_FEE_BPS);
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * BPS_DENOMINATOR + amountInWithFee);
        
        require(amountOut >= minAmountOut, "Slippage exceeded");
        
        // Update reserves
        if (isAtoB) {
            pool.reserveA += amountIn;
            pool.reserveB -= amountOut;
        } else {
            pool.reserveB += amountIn;
            pool.reserveA -= amountOut;
        }
        
        // Transfer tokens
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        
        address tokenOut = isAtoB ? pool.tokenB : pool.tokenA;
        IERC20(tokenOut).safeTransfer(recipient, amountOut);
        
        uint256 fee = (amountIn * LP_FEE_BPS) / BPS_DENOMINATOR;
        emit Swap(poolId, recipient, tokenIn, tokenOut, amountIn, amountOut, fee);
        
        return amountOut;
    }

    /**
     * @notice Get quote for a swap
     */
    function getAmountOut(
        bytes32 poolId,
        address tokenIn,
        uint256 amountIn
    ) external view returns (uint256 amountOut) {
        Pool storage pool = pools[poolId];
        require(pool.active, "Pool not active");
        
        bool isAtoB = tokenIn == pool.tokenA;
        
        (uint256 reserveIn, uint256 reserveOut) = isAtoB 
            ? (pool.reserveA, pool.reserveB) 
            : (pool.reserveB, pool.reserveA);
        
        uint256 amountInWithFee = amountIn * (BPS_DENOMINATOR - LP_FEE_BPS);
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * BPS_DENOMINATOR + amountInWithFee);
        
        return amountOut;
    }

    /**
     * @notice Get pool reserves
     */
    function getReserves(bytes32 poolId) external view returns (uint256 reserveA, uint256 reserveB) {
        Pool storage pool = pools[poolId];
        return (pool.reserveA, pool.reserveB);
    }
}
