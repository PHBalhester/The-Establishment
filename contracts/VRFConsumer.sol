// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@chainlink/contracts/src/v0.8/vrf/interfaces/IVRFCoordinatorV2.sol";
import "@chainlink/contracts/src/v0.8/vrf/VRFConsumerBaseV2.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IEpochManager.sol";

/**
 * @title VRFConsumer
 * @notice Chainlink VRF v2 consumer for The Establishment epoch randomization
 * @dev Requests random numbers for epoch transitions and Carnage events
 */
contract VRFConsumer is VRFConsumerBaseV2, AccessControl {
    bytes32 public constant REQUESTER_ROLE = keccak256("REQUESTER_ROLE");

    IVRFCoordinatorV2 public immutable vrfCoordinator;
    
    // VRF configuration
    bytes32 public keyHash;
    uint64 public subscriptionId;
    uint16 public requestConfirmations = 3;
    uint32 public callbackGasLimit = 200000;
    uint32 public numWords = 1;

    // Request tracking
    mapping(uint256 => bool) public pendingRequests;
    uint256 public lastRequestId;
    uint256 public lastRandomValue;

    // EpochManager to notify
    address public epochManager;

    event RandomnessRequested(uint256 indexed requestId);
    event RandomnessFulfilled(uint256 indexed requestId, uint256 randomValue);
    event ConfigUpdated(bytes32 keyHash, uint64 subscriptionId);

    constructor(
        address admin,
        address _vrfCoordinator,
        bytes32 _keyHash,
        uint64 _subscriptionId
    ) VRFConsumerBaseV2(_vrfCoordinator) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REQUESTER_ROLE, admin);
        
        vrfCoordinator = IVRFCoordinatorV2(_vrfCoordinator);
        keyHash = _keyHash;
        subscriptionId = _subscriptionId;
    }

    function setEpochManager(address _epochManager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        epochManager = _epochManager;
        _grantRole(REQUESTER_ROLE, _epochManager);
    }

    function updateConfig(
        bytes32 _keyHash,
        uint64 _subscriptionId,
        uint16 _requestConfirmations,
        uint32 _callbackGasLimit
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        keyHash = _keyHash;
        subscriptionId = _subscriptionId;
        requestConfirmations = _requestConfirmations;
        callbackGasLimit = _callbackGasLimit;
        
        emit ConfigUpdated(_keyHash, _subscriptionId);
    }

    /**
     * @notice Request random number for epoch transition
     * @dev Called by EpochManager when advancing epochs
     */
    function requestRandomness() external onlyRole(REQUESTER_ROLE) returns (uint256 requestId) {
        requestId = vrfCoordinator.requestRandomWords(
            keyHash,
            subscriptionId,
            requestConfirmations,
            callbackGasLimit,
            numWords
        );

        pendingRequests[requestId] = true;
        lastRequestId = requestId;

        emit RandomnessRequested(requestId);
        return requestId;
    }

    /**
     * @dev Callback function called by VRF Coordinator
     */
    function fulfillRandomWords(
        uint256 requestId,
        uint256[] memory randomWords
    ) internal override {
        require(pendingRequests[requestId], "Request not found");
        
        pendingRequests[requestId] = false;
        lastRandomValue = randomWords[0];

        emit RandomnessFulfilled(requestId, randomWords[0]);

        // Forward to EpochManager if configured
        if (epochManager != address(0)) {
            // Call EpochManager's fulfillRandomness function
            // This updates epoch state with the random value
            (bool success, ) = epochManager.call(
                abi.encodeWithSignature(
                    "fulfillRandomness(uint256,uint256)",
                    requestId,
                    randomWords[0]
                )
            );
            // Log failure but don't revert (VRF callback should not fail)
            if (!success) {
                // Emit event for monitoring
            }
        }
    }

    /**
     * @notice Get the last random value received
     */
    function getLastRandomValue() external view returns (uint256) {
        return lastRandomValue;
    }

    /**
     * @notice Check if a request is pending
     */
    function isRequestPending(uint256 requestId) external view returns (bool) {
        return pendingRequests[requestId];
    }
}
