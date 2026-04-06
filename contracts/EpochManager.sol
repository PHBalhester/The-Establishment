// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title EpochManager
 * @notice Manages epoch transitions, tax rates, and Carnage events
 * @dev Uses Chainlink VRF for randomization on Arc Network
 */
contract EpochManager is AccessControl, ReentrancyGuard {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant VRF_ROLE = keccak256("VRF_ROLE");

    // Epoch configuration
    uint256 public constant EPOCH_DURATION = 30 minutes;
    uint256 public constant CARNAGE_PROBABILITY_BPS = 430; // ~4.3%
    uint256 public constant BPS_DENOMINATOR = 10000;

    // Tax rates in basis points
    uint256 public constant LOW_TAX_MIN_BPS = 100;   // 1%
    uint256 public constant LOW_TAX_MAX_BPS = 400;   // 4%
    uint256 public constant HIGH_TAX_MIN_BPS = 1100; // 11%
    uint256 public constant HIGH_TAX_MAX_BPS = 1400; // 14%

    enum EpochPhase {
        LOW_TAX,
        HIGH_TAX
    }

    struct EpochState {
        uint256 epochNumber;
        uint256 startTime;
        uint256 endTime;
        EpochPhase phase;
        uint256 taxRateBps;
        bool carnageTriggered;
        uint256 randomSeed;
    }

    EpochState public currentEpoch;
    
    // Historical epochs
    mapping(uint256 => EpochState) public epochs;
    
    // Carnage fund address
    address public carnageFund;
    
    // VRF integration (Chainlink)
    address public vrfCoordinator;
    uint256 public lastVrfRequestId;

    event EpochAdvanced(
        uint256 indexed epochNumber,
        EpochPhase phase,
        uint256 taxRateBps,
        uint256 startTime
    );
    event CarnageTriggered(uint256 indexed epochNumber, uint256 randomValue);
    event TaxRateUpdated(uint256 newRateBps);
    event VrfRequestSent(uint256 requestId);
    event VrfFulfilled(uint256 requestId, uint256 randomValue);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        
        // Initialize first epoch
        currentEpoch = EpochState({
            epochNumber: 1,
            startTime: block.timestamp,
            endTime: block.timestamp + EPOCH_DURATION,
            phase: EpochPhase.LOW_TAX,
            taxRateBps: LOW_TAX_MIN_BPS,
            carnageTriggered: false,
            randomSeed: 0
        });
        
        epochs[1] = currentEpoch;
        
        emit EpochAdvanced(1, EpochPhase.LOW_TAX, LOW_TAX_MIN_BPS, block.timestamp);
    }

    function setCarnageFund(address _carnageFund) external onlyRole(DEFAULT_ADMIN_ROLE) {
        carnageFund = _carnageFund;
    }

    function setVrfCoordinator(address _vrfCoordinator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        vrfCoordinator = _vrfCoordinator;
        _grantRole(VRF_ROLE, _vrfCoordinator);
    }

    /**
     * @notice Check if epoch can be advanced
     */
    function canAdvanceEpoch() public view returns (bool) {
        return block.timestamp >= currentEpoch.endTime;
    }

    /**
     * @notice Advance to next epoch
     * @dev Anyone can call this when epoch timer expires
     */
    function advanceEpoch() external nonReentrant {
        require(canAdvanceEpoch(), "Epoch not ended");
        
        uint256 newEpochNumber = currentEpoch.epochNumber + 1;
        
        // Alternate between LOW and HIGH tax phases
        EpochPhase newPhase = currentEpoch.phase == EpochPhase.LOW_TAX 
            ? EpochPhase.HIGH_TAX 
            : EpochPhase.LOW_TAX;
        
        // Calculate new tax rate (will be updated by VRF)
        uint256 newTaxRate = _getBaseTaxRate(newPhase);
        
        currentEpoch = EpochState({
            epochNumber: newEpochNumber,
            startTime: block.timestamp,
            endTime: block.timestamp + EPOCH_DURATION,
            phase: newPhase,
            taxRateBps: newTaxRate,
            carnageTriggered: false,
            randomSeed: 0
        });
        
        epochs[newEpochNumber] = currentEpoch;
        
        emit EpochAdvanced(newEpochNumber, newPhase, newTaxRate, block.timestamp);
        
        // Request VRF for randomization
        _requestRandomness();
    }

    /**
     * @notice Callback for VRF fulfillment
     * @dev Called by Chainlink VRF Coordinator
     */
    function fulfillRandomness(uint256 requestId, uint256 randomValue) external onlyRole(VRF_ROLE) {
        require(requestId == lastVrfRequestId, "Invalid request");
        
        currentEpoch.randomSeed = randomValue;
        
        // Update tax rate based on randomness
        uint256 newTaxRate = _calculateTaxRate(currentEpoch.phase, randomValue);
        currentEpoch.taxRateBps = newTaxRate;
        
        // Check for Carnage trigger
        uint256 carnageRoll = randomValue % BPS_DENOMINATOR;
        if (carnageRoll < CARNAGE_PROBABILITY_BPS) {
            currentEpoch.carnageTriggered = true;
            emit CarnageTriggered(currentEpoch.epochNumber, randomValue);
        }
        
        epochs[currentEpoch.epochNumber] = currentEpoch;
        
        emit VrfFulfilled(requestId, randomValue);
        emit TaxRateUpdated(newTaxRate);
    }

    /**
     * @notice Get current tax rate
     */
    function getCurrentTaxRate() external view returns (uint256) {
        return currentEpoch.taxRateBps;
    }

    /**
     * @notice Get current epoch info
     */
    function getEpochInfo() external view returns (
        uint256 epochNumber,
        uint256 startTime,
        uint256 endTime,
        EpochPhase phase,
        uint256 taxRateBps,
        bool carnageTriggered
    ) {
        return (
            currentEpoch.epochNumber,
            currentEpoch.startTime,
            currentEpoch.endTime,
            currentEpoch.phase,
            currentEpoch.taxRateBps,
            currentEpoch.carnageTriggered
        );
    }

    /**
     * @notice Time remaining in current epoch
     */
    function timeUntilNextEpoch() external view returns (uint256) {
        if (block.timestamp >= currentEpoch.endTime) {
            return 0;
        }
        return currentEpoch.endTime - block.timestamp;
    }

    // Internal functions

    function _getBaseTaxRate(EpochPhase phase) internal pure returns (uint256) {
        if (phase == EpochPhase.LOW_TAX) {
            return LOW_TAX_MIN_BPS;
        }
        return HIGH_TAX_MIN_BPS;
    }

    function _calculateTaxRate(EpochPhase phase, uint256 randomValue) internal pure returns (uint256) {
        if (phase == EpochPhase.LOW_TAX) {
            uint256 range = LOW_TAX_MAX_BPS - LOW_TAX_MIN_BPS;
            return LOW_TAX_MIN_BPS + (randomValue % range);
        } else {
            uint256 range = HIGH_TAX_MAX_BPS - HIGH_TAX_MIN_BPS;
            return HIGH_TAX_MIN_BPS + (randomValue % range);
        }
    }

    function _requestRandomness() internal {
        // Placeholder for Chainlink VRF request
        // In production, this would call the VRF Coordinator
        lastVrfRequestId = uint256(keccak256(abi.encodePacked(block.timestamp, currentEpoch.epochNumber)));
        emit VrfRequestSent(lastVrfRequestId);
    }

    /**
     * @notice Manual VRF fulfillment for testing (remove in production)
     */
    function manualFulfillRandomness(uint256 randomValue) external onlyRole(OPERATOR_ROLE) {
        fulfillRandomness(lastVrfRequestId, randomValue);
    }
}
