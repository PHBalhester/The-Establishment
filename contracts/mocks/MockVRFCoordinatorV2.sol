// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@chainlink/contracts/src/v0.8/vrf/interfaces/IVRFCoordinatorV2.sol";

/**
 * @title MockVRFCoordinatorV2
 * @notice Mock VRF Coordinator for testing on Arc Testnet
 * @dev Simulates Chainlink VRF v2 behavior for development and testing
 */
contract MockVRFCoordinatorV2 {
    uint256 private _requestIdCounter;
    
    struct Request {
        address consumer;
        uint64 subId;
        uint32 callbackGasLimit;
        uint32 numWords;
        bool fulfilled;
    }
    
    mapping(uint256 => Request) public requests;
    
    event RandomWordsRequested(
        bytes32 indexed keyHash,
        uint256 requestId,
        uint256 preSeed,
        uint64 indexed subId,
        uint16 minimumRequestConfirmations,
        uint32 callbackGasLimit,
        uint32 numWords,
        address indexed sender
    );
    
    event RandomWordsFulfilled(
        uint256 indexed requestId,
        uint256 outputSeed,
        uint96 payment,
        bool success
    );

    function requestRandomWords(
        bytes32 keyHash,
        uint64 subId,
        uint16 minimumRequestConfirmations,
        uint32 callbackGasLimit,
        uint32 numWords
    ) external returns (uint256 requestId) {
        requestId = ++_requestIdCounter;
        
        requests[requestId] = Request({
            consumer: msg.sender,
            subId: subId,
            callbackGasLimit: callbackGasLimit,
            numWords: numWords,
            fulfilled: false
        });
        
        emit RandomWordsRequested(
            keyHash,
            requestId,
            uint256(keccak256(abi.encode(requestId, block.timestamp))),
            subId,
            minimumRequestConfirmations,
            callbackGasLimit,
            numWords,
            msg.sender
        );
        
        return requestId;
    }

    /**
     * @notice Manually fulfill a random words request (for testing)
     * @param requestId The request to fulfill
     * @param randomValue The random value to use (or 0 for pseudo-random)
     */
    function fulfillRandomWords(uint256 requestId, uint256 randomValue) external {
        Request storage request = requests[requestId];
        require(request.consumer != address(0), "Request not found");
        require(!request.fulfilled, "Already fulfilled");
        
        request.fulfilled = true;
        
        // Generate random words
        uint256[] memory randomWords = new uint256[](request.numWords);
        for (uint32 i = 0; i < request.numWords; i++) {
            if (randomValue == 0) {
                // Generate pseudo-random value if none provided
                randomWords[i] = uint256(keccak256(abi.encode(
                    requestId, 
                    i, 
                    block.timestamp, 
                    block.prevrandao,
                    blockhash(block.number - 1)
                )));
            } else {
                randomWords[i] = uint256(keccak256(abi.encode(randomValue, i)));
            }
        }
        
        // Call consumer's fulfillRandomWords
        (bool success, ) = request.consumer.call(
            abi.encodeWithSignature(
                "rawFulfillRandomWords(uint256,uint256[])",
                requestId,
                randomWords
            )
        );
        
        emit RandomWordsFulfilled(requestId, randomWords[0], 0, success);
    }

    /**
     * @notice Auto-fulfill for development (immediately returns random)
     */
    function fulfillRandomWordsWithRandomness(uint256 requestId) external {
        fulfillRandomWords(requestId, 0);
    }

    /**
     * @notice Get the current request ID counter
     */
    function getRequestIdCounter() external view returns (uint256) {
        return _requestIdCounter;
    }

    /**
     * @notice Check if a request has been fulfilled
     */
    function isRequestFulfilled(uint256 requestId) external view returns (bool) {
        return requests[requestId].fulfilled;
    }
}
