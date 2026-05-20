// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TaskEscrow
 * @notice 任务资金托管合约，确保无信任结算
 */
contract TaskEscrow is ReentrancyGuard, Ownable {

    IERC20 public immutable usdc;
    IAgentRegistry public immutable registry;

    // #4: removed constant keyword, added setter function
    uint256 public platformFeesBps = 50; // 0.5%
    address public feeRecipient;

    enum TaskStatus { Empty, Locked, Released, Disputed, Refunded }

    // #5: added taskId and lockedAt fields to match doc spec
    struct Task {
        bytes32 taskId;
        address requester;
        address provider;
        uint256 amount;       // USDC (6 decimals)
        TaskStatus status;
        uint256 lockedAt;
        uint256 deadline;
        bytes32 agreementHash; // 协商协议的哈希
    }

    mapping(bytes32 => Task) public tasks;

    // #10: event signatures match doc spec
    event FundsLocked(bytes32 indexed taskId, address requester, address provider, uint256 amount);
    event FundsReleased(bytes32 indexed taskId, uint256 amount, uint256 fee);
    event DisputeRaised(bytes32 indexed taskId, address raisedBy);
    event FundsRefunded(bytes32 indexed taskId);

    constructor(address _usdc, address _registry, address _feeRecipient)
        Ownable(msg.sender)
    {
        require(_usdc != address(0), "TaskEscrow: zero USDC address");
        require(_registry != address(0), "TaskEscrow: zero registry address");
        require(_feeRecipient != address(0), "TaskEscrow: zero fee recipient");

        usdc = IERC20(_usdc);
        registry = IAgentRegistry(_registry);
        feeRecipient = _feeRecipient;
    }

    /**
     * @notice 设置平台费率 (仅 owner)
     * #4: added setter for platformFeesBps
     */
    function setPlatformFee(uint256 newBps) external onlyOwner {
        require(newBps <= 1000, "Fee too high"); // max 10%
        platformFeesBps = newBps;
    }

    /**
     * @notice Requester 锁定资金
     * #9: transferFrom moved before struct assignment (checks-effects-interactions)
     */
    function deposit(
        bytes32 taskId,
        uint256 amount,
        address provider,
        uint256 deadline,
        bytes32 agreementHash
    ) external nonReentrant {
        require(tasks[taskId].status == TaskStatus.Empty, "Task exists");
        require(amount > 0, "Amount must be positive");
        require(provider != address(0), "Invalid provider");
        require(deadline > block.timestamp, "Deadline must be future");

        // #9: transfer first (checks-effects-interactions pattern)
        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        // #5: taskId and lockedAt assigned in struct
        tasks[taskId] = Task({
            taskId: taskId,
            requester: msg.sender,
            provider: provider,
            amount: amount,
            status: TaskStatus.Locked,
            lockedAt: block.timestamp,
            deadline: deadline,
            agreementHash: agreementHash
        });

        emit FundsLocked(taskId, msg.sender, provider, amount);
    }

    /**
     * @notice Requester 验收任务，释放资金给 Provider
     */
    function release(bytes32 taskId) external nonReentrant {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.Locked, "Not locked");
        require(msg.sender == task.requester, "Not requester");

        task.status = TaskStatus.Released;

        // 计算平台费用
        uint256 fee = (task.amount * platformFeesBps) / 10000;
        uint256 providerAmount = task.amount - fee;

        // 转账给 Provider（亚秒结算）
        require(usdc.transfer(task.provider, providerAmount), "Provider transfer failed");
        if (fee > 0) {
            require(usdc.transfer(feeRecipient, fee), "Fee transfer failed");
        }

        // #10: event matches doc spec (no provider param)
        emit FundsReleased(taskId, providerAmount, fee);
    }

    /**
     * @notice 超时自动退款（deadline 过后 Provider 未完成）
     */
    function refundOnTimeout(bytes32 taskId) external nonReentrant {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.Locked, "Not locked");
        require(block.timestamp > task.deadline, "Not expired");

        task.status = TaskStatus.Refunded;
        require(usdc.transfer(task.requester, task.amount), "Refund failed");

        // #10: event matches doc spec (no extra params)
        emit FundsRefunded(taskId);
    }

    /**
     * @notice 发起争议（交由 Arbiter 裁决）
     */
    function dispute(bytes32 taskId, bytes32 evidenceHash) external {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.Locked, "Not locked");
        require(
            msg.sender == task.requester || msg.sender == task.provider,
            "Not party"
        );

        task.status = TaskStatus.Disputed;
        emit DisputeRaised(taskId, msg.sender);
    }
}

// #3: interface updated to match new bool parameter
interface IAgentRegistry {
    function updateReputation(uint256 agentId, uint256 newScore, bool incrementTaskCount) external;
    function addressToAgentId(address addr) external view returns (uint256);
}
