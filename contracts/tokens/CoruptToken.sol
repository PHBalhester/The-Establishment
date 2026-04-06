// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title CoruptToken (CORUPT)
 * @notice ERC-20 token with transfer hooks for tax collection
 * @dev Formerly known as FRAUD token on Solana
 */
contract CoruptToken is ERC20, ERC20Burnable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant TAX_CONTROLLER_ROLE = keccak256("TAX_CONTROLLER_ROLE");

    address public taxController;
    bool public taxEnabled;
    
    // Addresses exempt from tax (pools, protocol contracts)
    mapping(address => bool) public taxExempt;

    event TaxControllerUpdated(address indexed oldController, address indexed newController);
    event TaxStatusUpdated(bool enabled);
    event TaxExemptionUpdated(address indexed account, bool exempt);

    constructor(address admin) ERC20("Corruption", "CORUPT") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        taxEnabled = false;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    function setTaxController(address _taxController) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address oldController = taxController;
        taxController = _taxController;
        _grantRole(TAX_CONTROLLER_ROLE, _taxController);
        emit TaxControllerUpdated(oldController, _taxController);
    }

    function setTaxEnabled(bool _enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        taxEnabled = _enabled;
        emit TaxStatusUpdated(_enabled);
    }

    function setTaxExempt(address account, bool exempt) external onlyRole(DEFAULT_ADMIN_ROLE) {
        taxExempt[account] = exempt;
        emit TaxExemptionUpdated(account, exempt);
    }

    /**
     * @dev Override to implement transfer hooks for taxation
     */
    function _update(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        super._update(from, to, amount);
    }
}
