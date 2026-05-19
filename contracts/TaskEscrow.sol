// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract TaskEscrow is ReentrancyGuard, Ownable {
    enum TaskStatus { Empty, Locked, Released, Disputed, Refunded }

    struct Task {
        address requester;
        address provider;
        uint256 amount;
        uint256 deadline;
        bytes32 agreementHash;
        TaskStatus status;
    }

    IERC20 public usdc;
    IAgentRegistry public registry;
    address public feeRecipient;
    uint256 public constant platformFeesBps = 50; // 0.5%

    mapping(bytes32 => Task) public tasks;

    event FundsLocked(bytes32 indexed taskId, address indexed requester, address indexed provider, uint256 amount);
    event FundsReleased(bytes32 indexed taskId, address indexed provider, uint256 amount, uint256 fee);
    event DisputeRaised(bytes32 indexed taskId, address indexed raisedBy);
    event FundsRefunded(bytes32 indexed taskId, address indexed requester, uint256 amount);

    constructor(address _usdc, address _registry, address _feeRecipient) Ownable(msg.sender) {
        require(_usdc != address(0), "TaskEscrow: zero USDC address");
        require(_registry != address(0), "TaskEscrow: zero registry address");
        require(_feeRecipient != address(0), "TaskEscrow: zero fee recipient");

        usdc = IERC20(_usdc);
        registry = IAgentRegistry(_registry);
        feeRecipient = _feeRecipient;
    }

    function deposit(
        bytes32 taskId,
        uint256 amount,
        address provider,
        uint256 deadline,
        bytes32 agreementHash
    ) external nonReentrant {
        require(tasks[taskId].status == TaskStatus.Empty, "TaskEscrow: task already exists");
        require(amount > 0, "TaskEscrow: zero amount");
        require(provider != address(0), "TaskEscrow: zero provider");
        require(deadline > block.timestamp, "TaskEscrow: deadline in the past");

        tasks[taskId] = Task({
            requester: msg.sender,
            provider: provider,
            amount: amount,
            deadline: deadline,
            agreementHash: agreementHash,
            status: TaskStatus.Locked
        });

        require(usdc.transferFrom(msg.sender, address(this), amount), "TaskEscrow: transfer failed");

        emit FundsLocked(taskId, msg.sender, provider, amount);
    }

    function release(bytes32 taskId) external nonReentrant {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.Locked, "TaskEscrow: task not locked");
        require(msg.sender == task.requester, "TaskEscrow: only requester can release");

        task.status = TaskStatus.Released;

        uint256 fee = (task.amount * platformFeesBps) / 10000;
        uint256 payout = task.amount - fee;

        require(usdc.transfer(task.provider, payout), "TaskEscrow: payout transfer failed");
        if (fee > 0) {
            require(usdc.transfer(feeRecipient, fee), "TaskEscrow: fee transfer failed");
        }

        emit FundsReleased(taskId, task.provider, payout, fee);
    }

    function refundOnTimeout(bytes32 taskId) external nonReentrant {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.Locked, "TaskEscrow: task not locked");
        require(block.timestamp > task.deadline, "TaskEscrow: deadline not passed");

        task.status = TaskStatus.Refunded;

        require(usdc.transfer(task.requester, task.amount), "TaskEscrow: refund transfer failed");

        emit FundsRefunded(taskId, task.requester, task.amount);
    }

    function dispute(bytes32 taskId, bytes32 evidenceHash) external {
        Task storage task = tasks[taskId];
        require(task.status == TaskStatus.Locked, "TaskEscrow: task not locked");
        require(
            msg.sender == task.requester || msg.sender == task.provider,
            "TaskEscrow: only requester or provider can dispute"
        );

        task.status = TaskStatus.Disputed;

        emit DisputeRaised(taskId, msg.sender);
    }
}

interface IAgentRegistry {
    function updateReputation(uint256 agentId, uint256 newScore, uint256 taskIncrement) external;
}
