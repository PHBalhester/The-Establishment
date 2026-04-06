// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../tokens/BribeToken.sol";
import "../tokens/CoruptToken.sol";
import "../tokens/VotesToken.sol";
import "../AMM.sol";
import "../TaxController.sol";
import "../EpochManager.sol";
import "../VotesStaking.sol";
import "../ConversionVault.sol";

/**
 * @title DeployScript
 * @notice Deploys all The Establishment contracts to Arc Network
 */
contract DeployScript is Script {
    // Deployed contract addresses
    BribeToken public bribeToken;
    CoruptToken public coruptToken;
    VotesToken public votesToken;
    AMM public amm;
    TaxController public taxController;
    EpochManager public epochManager;
    VotesStaking public votesStaking;
    ConversionVault public conversionVault;

    // USDC address on Arc Network (to be set)
    address public usdc;

    function run() external {
        // Get deployer private key from env
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        // USDC address (native on Arc, or bridged)
        usdc = vm.envAddress("USDC_ADDRESS");
        
        console.log("Deploying The Establishment to Arc Network...");
        console.log("Deployer:", deployer);
        console.log("USDC:", usdc);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy tokens
        console.log("\n--- Deploying Tokens ---");
        
        bribeToken = new BribeToken(deployer);
        console.log("BribeToken deployed:", address(bribeToken));
        
        coruptToken = new CoruptToken(deployer);
        console.log("CoruptToken deployed:", address(coruptToken));
        
        votesToken = new VotesToken(deployer);
        console.log("VotesToken deployed:", address(votesToken));

        // 2. Deploy EpochManager
        console.log("\n--- Deploying EpochManager ---");
        epochManager = new EpochManager(deployer);
        console.log("EpochManager deployed:", address(epochManager));

        // 3. Deploy AMM
        console.log("\n--- Deploying AMM ---");
        amm = new AMM(
            deployer,
            usdc,
            address(bribeToken),
            address(coruptToken)
        );
        console.log("AMM deployed:", address(amm));

        // 4. Deploy TaxController
        console.log("\n--- Deploying TaxController ---");
        taxController = new TaxController(
            deployer,
            address(amm),
            address(epochManager),
            usdc
        );
        console.log("TaxController deployed:", address(taxController));

        // 5. Deploy VotesStaking
        console.log("\n--- Deploying VotesStaking ---");
        votesStaking = new VotesStaking(
            deployer,
            address(votesToken),
            usdc
        );
        console.log("VotesStaking deployed:", address(votesStaking));

        // 6. Deploy ConversionVault
        console.log("\n--- Deploying ConversionVault ---");
        conversionVault = new ConversionVault(
            deployer,
            address(bribeToken),
            address(coruptToken),
            address(votesToken)
        );
        console.log("ConversionVault deployed:", address(conversionVault));

        // 7. Configure permissions
        console.log("\n--- Configuring Permissions ---");
        
        // Set TaxController on tokens
        bribeToken.setTaxController(address(taxController));
        coruptToken.setTaxController(address(taxController));
        
        // Set TaxController on AMM
        amm.setTaxController(address(taxController));
        
        // Configure TaxController addresses
        taxController.setAddresses(
            address(votesStaking),  // staking
            deployer,               // carnage fund (temporary)
            deployer                // treasury (temporary)
        );
        
        // Set staking contract on VotesToken
        votesToken.setStakingContract(address(votesStaking));
        
        // Grant ConversionVault permission to mint VOTES
        votesToken.grantConversionVaultRole(address(conversionVault));
        
        // Set carnage fund on EpochManager
        epochManager.setCarnageFund(deployer); // temporary
        
        console.log("Permissions configured!");

        vm.stopBroadcast();

        // Output deployment summary
        console.log("\n========================================");
        console.log("DEPLOYMENT COMPLETE!");
        console.log("========================================");
        console.log("\nContract Addresses:");
        console.log("BRIBE Token:", address(bribeToken));
        console.log("CORUPT Token:", address(coruptToken));
        console.log("VOTES Token:", address(votesToken));
        console.log("AMM:", address(amm));
        console.log("TaxController:", address(taxController));
        console.log("EpochManager:", address(epochManager));
        console.log("VotesStaking:", address(votesStaking));
        console.log("ConversionVault:", address(conversionVault));
        console.log("\nSave these addresses in your .env file!");
    }
}
