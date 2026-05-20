// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAgentRegistryForFund {
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
 * @title AgentFund
 * @notice On-chain Agent investment fund with automatic dividend distribution
 * @dev High-reputation Agents can raise capital; investors automatically receive
 *      a share of every task revenue as dividends
 */
contract AgentFund is ReentrancyGuard {

    IERC20 public immutable usdc;
    IAgentRegistryForFund public immutable registry;
    address public owner;

    uint256 public constant MIN_REPUTATION_TO_RAISE = 420; // 4.20 score
    uint256 public constant MIN_TASKS_TO_RAISE = 20;

    struct Fund {
        uint256 fundId;
        uint256 agentId;
        uint256 targetAmount;
        uint256 raisedAmount;
        uint256 investorShareBps; // e.g., 2000 = 20%
        uint256 deadline;
        bool active;
        bool funded; // true when target reached
        uint256 totalDividendsDistributed;
        uint256 createdAt;
    }

    // Separate investor tracking to avoid nested mapping in struct
    mapping(uint256 => mapping(address => uint256)) public investments;
    mapping(uint256 => address[]) public fundInvestors;

    mapping(uint256 => Fund) public funds;
    mapping(uint256 => uint256) public agentFundId; // agentId => fundId
    uint256 public nextFundId = 1;

    address public escrowContract;

    event FundCreated(uint256 indexed fundId, uint256 agentId, uint256 targetAmount, uint256 investorShareBps);
    event Invested(uint256 indexed fundId, address investor, uint256 amount);
    event FundFullyRaised(uint256 indexed fundId, uint256 totalRaised);
    event DividendDistributed(uint256 indexed fundId, uint256 totalAmount, uint256 investorCount);
    event FundDeactivated(uint256 indexed fundId);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyEscrow() {
        require(msg.sender == escrowContract, "Not escrow");
        _;
    }

    constructor(address _usdc, address _registry) {
        usdc = IERC20(_usdc);
        registry = IAgentRegistryForFund(_registry);
        owner = msg.sender;
    }

    function createFund(
        uint256 agentId,
        uint256 targetAmount,
        uint256 investorShareBps,
        uint256 durationDays
    ) external nonReentrant returns (uint256 fundId) {
        IAgentRegistryForFund.Agent memory agent = registry.getAgent(agentId);
        require(agent.owner == msg.sender, "Not agent owner");
        require(agent.reputationScore >= MIN_REPUTATION_TO_RAISE, "Reputation too low (min 4.20)");
        require(agent.totalTasks >= MIN_TASKS_TO_RAISE, "Too few completed tasks (min 20)");
        require(agentFundId[agentId] == 0, "Already has active fund");
        require(investorShareBps > 0 && investorShareBps <= 5000, "Share 0.01%-50%");
        require(targetAmount > 0, "Target must be > 0");
        require(durationDays > 0 && durationDays <= 365, "Duration 1-365 days");

        fundId = nextFundId++;
        funds[fundId] = Fund({
            fundId: fundId,
            agentId: agentId,
            targetAmount: targetAmount,
            raisedAmount: 0,
            investorShareBps: investorShareBps,
            deadline: block.timestamp + durationDays * 1 days,
            active: true,
            funded: false,
            totalDividendsDistributed: 0,
            createdAt: block.timestamp
        });
        agentFundId[agentId] = fundId;

        emit FundCreated(fundId, agentId, targetAmount, investorShareBps);
    }

    function invest(uint256 fundId, uint256 amount) external nonReentrant {
        Fund storage fund = funds[fundId];
        require(fund.active, "Fund not active");
        require(block.timestamp < fund.deadline, "Fundraising ended");
        require(fund.raisedAmount + amount <= fund.targetAmount, "Exceeds target");
        require(amount > 0, "Amount must be > 0");
        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        if (investments[fundId][msg.sender] == 0) {
            fundInvestors[fundId].push(msg.sender);
        }
        investments[fundId][msg.sender] += amount;
        fund.raisedAmount += amount;

        emit Invested(fundId, msg.sender, amount);

        // Release funds to agent owner when fully raised
        if (fund.raisedAmount >= fund.targetAmount) {
            fund.funded = true;
            IAgentRegistryForFund.Agent memory agent = registry.getAgent(fund.agentId);
            require(usdc.transfer(agent.owner, fund.targetAmount), "Release failed");
            emit FundFullyRaised(fundId, fund.raisedAmount);
        }
    }

    /**
     * @notice Distribute dividends to investors from task revenue
     * @dev Called by TaskEscrow on task settlement
     */
    function distributeDividend(uint256 agentId, uint256 taskRevenue) external onlyEscrow nonReentrant {
        uint256 fundId = agentFundId[agentId];
        if (fundId == 0) return;

        Fund storage fund = funds[fundId];
        if (!fund.active || !fund.funded) return;
        if (taskRevenue == 0) return;

        uint256 investorTotal = taskRevenue * fund.investorShareBps / 10000;
        if (investorTotal == 0) return;

        // Transfer the investor share from sender (escrow) to this contract first
        require(usdc.transferFrom(msg.sender, address(this), investorTotal), "Dividend transfer failed");

        address[] storage investors = fundInvestors[fundId];
        for (uint256 i = 0; i < investors.length; i++) {
            address investor = investors[i];
            uint256 investorAmount = investments[fundId][investor];
            uint256 share = (investorTotal * investorAmount) / fund.raisedAmount;
            if (share > 0) {
                usdc.transfer(investor, share);
            }
        }

        fund.totalDividendsDistributed += investorTotal;
        emit DividendDistributed(fundId, investorTotal, investors.length);
    }

    // --- View functions ---

    function getFund(uint256 fundId) external view returns (Fund memory) {
        return funds[fundId];
    }

    function getFundByAgent(uint256 agentId) external view returns (Fund memory) {
        uint256 fundId = agentFundId[agentId];
        require(fundId != 0, "No fund for agent");
        return funds[fundId];
    }

    function getInvestorCount(uint256 fundId) external view returns (uint256) {
        return fundInvestors[fundId].length;
    }

    function getInvestment(uint256 fundId, address investor) external view returns (uint256) {
        return investments[fundId][investor];
    }

    function getInvestorShare(uint256 fundId, address investor) external view returns (uint256 shareBps) {
        Fund storage fund = funds[fundId];
        if (fund.raisedAmount == 0) return 0;
        return (investments[fundId][investor] * 10000) / fund.raisedAmount;
    }

    // --- Admin ---

    function setEscrow(address addr) external onlyOwner {
        escrowContract = addr;
    }

    function deactivateFund(uint256 fundId) external {
        Fund storage fund = funds[fundId];
        IAgentRegistryForFund.Agent memory agent = registry.getAgent(fund.agentId);
        require(msg.sender == agent.owner || msg.sender == owner, "Not authorized");
        fund.active = false;
        agentFundId[fund.agentId] = 0;
        emit FundDeactivated(fundId);
    }

    /**
     * @notice Refund investors if fundraising deadline passes without reaching target
     */
    function refundExpiredFund(uint256 fundId) external nonReentrant {
        Fund storage fund = funds[fundId];
        require(fund.active, "Fund not active");
        require(!fund.funded, "Already funded");
        require(block.timestamp >= fund.deadline, "Not expired yet");

        fund.active = false;
        agentFundId[fund.agentId] = 0;

        // Refund all investors
        address[] storage investors = fundInvestors[fundId];
        for (uint256 i = 0; i < investors.length; i++) {
            address investor = investors[i];
            uint256 amount = investments[fundId][investor];
            if (amount > 0) {
                investments[fundId][investor] = 0;
                usdc.transfer(investor, amount);
            }
        }
    }
}
