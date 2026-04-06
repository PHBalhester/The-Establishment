// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title VotesStaking
 * @notice Stake VOTES tokens to earn USDC rewards from protocol fees
 * @dev Implements Synthetix-style cumulative reward distribution
 */
contract VotesStaking is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant REWARD_DISTRIBUTOR_ROLE = keccak256("REWARD_DISTRIBUTOR_ROLE");

    IERC20 public immutable votesToken;
    IERC20 public immutable usdc;

    // Staking state
    uint256 public totalStaked;
    uint256 public rewardPerTokenStored;
    uint256 public lastUpdateTime;

    // Cooldown period after claiming (12 hours)
    uint256 public constant CLAIM_COOLDOWN = 12 hours;

    // User state
    struct UserStake {
        uint256 stakedAmount;
        uint256 rewardPerTokenPaid;
        uint256 pendingRewards;
        uint256 lastClaimTime;
    }

    mapping(address => UserStake) public stakes;

    // Flash loan protection
    mapping(address => uint256) public lastStakeBlock;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardsClaimed(address indexed user, uint256 amount);
    event RewardsAdded(uint256 amount);

    constructor(
        address admin,
        address _votesToken,
        address _usdc
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REWARD_DISTRIBUTOR_ROLE, admin);
        
        votesToken = IERC20(_votesToken);
        usdc = IERC20(_usdc);
    }

    /**
     * @notice Stake VOTES tokens
     * @param amount Amount to stake
     */
    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot stake 0");
        
        // Flash loan protection
        lastStakeBlock[msg.sender] = block.number;
        
        votesToken.safeTransferFrom(msg.sender, address(this), amount);
        
        stakes[msg.sender].stakedAmount += amount;
        totalStaked += amount;
        
        emit Staked(msg.sender, amount);
    }

    /**
     * @notice Unstake VOTES tokens
     * @param amount Amount to unstake
     */
    function unstake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot unstake 0");
        require(stakes[msg.sender].stakedAmount >= amount, "Insufficient stake");
        
        // Flash loan protection
        require(block.number > lastStakeBlock[msg.sender], "Same block");
        
        stakes[msg.sender].stakedAmount -= amount;
        totalStaked -= amount;
        
        votesToken.safeTransfer(msg.sender, amount);
        
        emit Unstaked(msg.sender, amount);
    }

    /**
     * @notice Claim accumulated USDC rewards
     */
    function claimRewards() external nonReentrant updateReward(msg.sender) {
        UserStake storage userStake = stakes[msg.sender];
        
        // Cooldown check
        require(
            block.timestamp >= userStake.lastClaimTime + CLAIM_COOLDOWN,
            "Cooldown active"
        );
        
        uint256 reward = userStake.pendingRewards;
        require(reward > 0, "No rewards");
        
        userStake.pendingRewards = 0;
        userStake.lastClaimTime = block.timestamp;
        
        usdc.safeTransfer(msg.sender, reward);
        
        emit RewardsClaimed(msg.sender, reward);
    }

    /**
     * @notice Add rewards to the pool (called by TaxController)
     * @param amount Amount of USDC to add as rewards
     */
    function addRewards(uint256 amount) external onlyRole(REWARD_DISTRIBUTOR_ROLE) nonReentrant {
        require(amount > 0, "Zero amount");
        
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        
        if (totalStaked > 0) {
            rewardPerTokenStored += (amount * 1e18) / totalStaked;
        }
        
        lastUpdateTime = block.timestamp;
        
        emit RewardsAdded(amount);
    }

    /**
     * @notice Get pending rewards for a user
     */
    function pendingRewardsOf(address user) external view returns (uint256) {
        UserStake storage userStake = stakes[user];
        
        uint256 rewardPerToken = rewardPerTokenStored;
        
        uint256 pending = userStake.pendingRewards +
            (userStake.stakedAmount * (rewardPerToken - userStake.rewardPerTokenPaid)) / 1e18;
        
        return pending;
    }

    /**
     * @notice Get staked balance for a user
     */
    function stakedBalanceOf(address user) external view returns (uint256) {
        return stakes[user].stakedAmount;
    }

    /**
     * @notice Check if user can claim rewards
     */
    function canClaim(address user) external view returns (bool) {
        return block.timestamp >= stakes[user].lastClaimTime + CLAIM_COOLDOWN;
    }

    /**
     * @notice Time until user can claim
     */
    function timeUntilClaim(address user) external view returns (uint256) {
        uint256 cooldownEnd = stakes[user].lastClaimTime + CLAIM_COOLDOWN;
        if (block.timestamp >= cooldownEnd) {
            return 0;
        }
        return cooldownEnd - block.timestamp;
    }

    // Modifier to update reward state
    modifier updateReward(address account) {
        if (account != address(0)) {
            UserStake storage userStake = stakes[account];
            userStake.pendingRewards +=
                (userStake.stakedAmount * (rewardPerTokenStored - userStake.rewardPerTokenPaid)) / 1e18;
            userStake.rewardPerTokenPaid = rewardPerTokenStored;
        }
        _;
    }
}
