// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAgentRegistry {
    struct Agent {
        uint256 agentId;
        address owner;
        address wallet;
        string metadataCID;
        bytes32[] capabilityHashes;
        uint256 basePriceUsdc;
        bool isActive;
        uint256 registeredAt;
        uint256 updatedAt;
        uint256 totalTasks;
        uint256 reputationScore;
    }
    function getAgent(uint256 agentId) external view returns (Agent memory);
}

/**
 * @title AgentReputationMarket
 * @notice Prediction market for Agent task quality scores
 * @dev Users bet on whether an Agent's next task quality score will be above/below a threshold
 *      Market resolution reads actual on-chain scores after task completion
 */
contract AgentReputationMarket is ReentrancyGuard {

    IERC20 public immutable usdc;
    IAgentRegistry public immutable registry;
    uint256 public constant MIN_BET = 1; // 1 micro-USDC = $0.000001

    struct Market {
        uint256 marketId;
        uint256 agentId;
        uint256 taskId;
        uint256 threshold;        // Threshold (300 = 3.00 score)
        uint256 totalForAbove;
        uint256 totalForBelow;
        bool resolved;
        bool outcomeAbove;
        uint256 createdAt;
        uint256 resolvesAt;
    }

    struct Position {
        uint256 amountForAbove;
        uint256 amountForBelow;
        bool claimed;
    }

    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(address => Position)) public positions;
    uint256 public nextMarketId = 1;
    mapping(bytes32 => uint256) public channelBalances;

    address public escrowContract;
    address public owner;
    uint256 public platformFeeBps = 200; // 2%
    address public feeRecipient;

    event MarketCreated(uint256 indexed marketId, uint256 agentId, uint256 threshold);
    event BetPlaced(uint256 indexed marketId, address bettor, bool forAbove, uint256 amount);
    event MarketResolved(uint256 indexed marketId, bool outcomeAbove, uint256 actualScore);
    event WinningsClaimed(uint256 indexed marketId, address winner, uint256 amount);
    event BatchBetPlaced(uint256 indexed marketId, bool forAbove, uint256 totalAmount, uint256 betCount);

    modifier onlyEscrow() {
        require(msg.sender == escrowContract, "Not escrow");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _usdc, address _registry) {
        usdc = IERC20(_usdc);
        registry = IAgentRegistry(_registry);
        owner = msg.sender;
        feeRecipient = msg.sender;
    }

    function createMarket(uint256 agentId, uint256 taskId, uint256 threshold)
        external returns (uint256 marketId)
    {
        require(threshold >= 100 && threshold <= 500, "Threshold 1.00-5.00");
        IAgentRegistry.Agent memory agent = registry.getAgent(agentId);
        require(agent.isActive, "Agent not active");

        marketId = nextMarketId++;
        markets[marketId] = Market({
            marketId: marketId,
            agentId: agentId,
            taskId: taskId,
            threshold: threshold,
            totalForAbove: 0,
            totalForBelow: 0,
            resolved: false,
            outcomeAbove: false,
            createdAt: block.timestamp,
            resolvesAt: block.timestamp + 7 days
        });

        emit MarketCreated(marketId, agentId, threshold);
    }

    function placeBet(uint256 marketId, bool forAbove, uint256 amount) external nonReentrant {
        Market storage market = markets[marketId];
        require(market.marketId != 0, "Market does not exist");
        require(!market.resolved, "Market resolved");
        require(block.timestamp < market.resolvesAt, "Market expired");
        require(amount >= MIN_BET, "Below minimum bet");
        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        if (forAbove) {
            market.totalForAbove += amount;
            positions[marketId][msg.sender].amountForAbove += amount;
        } else {
            market.totalForBelow += amount;
            positions[marketId][msg.sender].amountForBelow += amount;
        }

        emit BetPlaced(marketId, msg.sender, forAbove, amount);
    }

    /**
     * @notice Batch bet placement for aggregated nanopayments
     */
    function placeBatchBet(uint256 marketId, bool forAbove, uint256 totalAmount, uint256 betCount)
        external nonReentrant
    {
        Market storage market = markets[marketId];
        require(market.marketId != 0, "Market does not exist");
        require(!market.resolved, "Market resolved");
        require(totalAmount >= MIN_BET, "Below minimum");
        require(usdc.transferFrom(msg.sender, address(this), totalAmount), "Transfer failed");

        if (forAbove) {
            market.totalForAbove += totalAmount;
            positions[marketId][msg.sender].amountForAbove += totalAmount;
        } else {
            market.totalForBelow += totalAmount;
            positions[marketId][msg.sender].amountForBelow += totalAmount;
        }

        emit BatchBetPlaced(marketId, forAbove, totalAmount, betCount);
    }

    function resolveMarket(uint256 marketId, uint256 actualScore) external onlyEscrow {
        Market storage market = markets[marketId];
        require(market.marketId != 0, "Market does not exist");
        require(!market.resolved, "Already resolved");
        market.resolved = true;
        market.outcomeAbove = actualScore >= market.threshold;
        emit MarketResolved(marketId, market.outcomeAbove, actualScore);
    }

    function claimWinnings(uint256 marketId) external nonReentrant {
        Market storage market = markets[marketId];
        require(market.resolved, "Not resolved");

        Position storage pos = positions[marketId][msg.sender];
        require(!pos.claimed, "Already claimed");
        pos.claimed = true;

        uint256 totalPool = market.totalForAbove + market.totalForBelow;
        uint256 fee = totalPool * platformFeeBps / 10000;
        uint256 netPool = totalPool - fee;
        uint256 winAmount;

        if (market.outcomeAbove && pos.amountForAbove > 0) {
            winAmount = (pos.amountForAbove * netPool) / market.totalForAbove;
        } else if (!market.outcomeAbove && pos.amountForBelow > 0) {
            winAmount = (pos.amountForBelow * netPool) / market.totalForBelow;
        }

        if (winAmount > 0) {
            require(usdc.transfer(msg.sender, winAmount), "Transfer failed");
        }

        // Transfer fee to recipient
        if (fee > 0) {
            usdc.transfer(feeRecipient, fee);
        }

        emit WinningsClaimed(marketId, msg.sender, winAmount);
    }

    // --- View functions ---

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return markets[marketId];
    }

    function getPosition(uint256 marketId, address user) external view returns (Position memory) {
        return positions[marketId][user];
    }

    function getImpliedProbability(uint256 marketId) external view returns (uint256) {
        Market storage market = markets[marketId];
        uint256 total = market.totalForAbove + market.totalForBelow;
        if (total == 0) return 5000; // 50%
        return (market.totalForAbove * 10000) / total;
    }

    function getActiveMarketCount() external view returns (uint256 count) {
        for (uint256 i = 1; i < nextMarketId; i++) {
            if (!markets[i].resolved && block.timestamp < markets[i].resolvesAt) {
                count++;
            }
        }
    }

    // --- Admin functions ---

    function setEscrow(address addr) external onlyOwner {
        escrowContract = addr;
    }

    function setFeeRecipient(address addr) external onlyOwner {
        feeRecipient = addr;
    }

    function setPlatformFee(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= 500, "Max 5%");
        platformFeeBps = newFeeBps;
    }
}
