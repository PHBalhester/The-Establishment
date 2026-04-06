// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IEpochManager {
    enum EpochPhase {
        LOW_TAX,
        HIGH_TAX
    }

    function getCurrentTaxRate() external view returns (uint256);
    
    function getEpochInfo() external view returns (
        uint256 epochNumber,
        uint256 startTime,
        uint256 endTime,
        EpochPhase phase,
        uint256 taxRateBps,
        bool carnageTriggered
    );
    
    function canAdvanceEpoch() external view returns (bool);
    function advanceEpoch() external;
    function timeUntilNextEpoch() external view returns (uint256);
}
