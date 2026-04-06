// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAMM {
    function swapExactInput(
        bytes32 poolId,
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external returns (uint256 amountOut);

    function getAmountOut(
        bytes32 poolId,
        address tokenIn,
        uint256 amountIn
    ) external view returns (uint256 amountOut);

    function getReserves(bytes32 poolId) external view returns (uint256 reserveA, uint256 reserveB);
    
    function BRIBE_POOL_ID() external view returns (bytes32);
    function CORUPT_POOL_ID() external view returns (bytes32);
}
