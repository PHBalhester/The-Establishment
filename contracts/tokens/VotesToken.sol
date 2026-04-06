// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title VotesToken (VOTES)
 * @notice Staking token - stake to earn USDC rewards from protocol fees
 * @dev Formerly known as PROFIT token on Solana
 */
contract VotesToken is ERC20, ERC20Burnable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant CONVERSION_VAULT_ROLE = keccak256("CONVERSION_VAULT_ROLE");

    address public stakingContract;
    
    // Addresses exempt from transfer restrictions
    mapping(address => bool) public transferAllowed;

    event StakingContractUpdated(address indexed oldContract, address indexed newContract);
    event TransferAllowedUpdated(address indexed account, bool allowed);

    constructor(address admin) ERC20("Votes", "VOTES") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /**
     * @dev Allows ConversionVault to mint VOTES when users convert BRIBE/CORUPT
     */
    function mintFromConversion(address to, uint256 amount) external onlyRole(CONVERSION_VAULT_ROLE) {
        _mint(to, amount);
    }

    function setStakingContract(address _stakingContract) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address oldContract = stakingContract;
        stakingContract = _stakingContract;
        transferAllowed[_stakingContract] = true;
        emit StakingContractUpdated(oldContract, _stakingContract);
    }

    function setTransferAllowed(address account, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        transferAllowed[account] = allowed;
        emit TransferAllowedUpdated(account, allowed);
    }

    function grantConversionVaultRole(address vault) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(CONVERSION_VAULT_ROLE, vault);
        transferAllowed[vault] = true;
    }
}
