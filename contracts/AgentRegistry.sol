// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AgentRegistry
 * @notice Arc 上 AI Agent 的链上注册表
 * @dev 存储 Agent 元数据 CID、能力哈希、信誉分
 */
contract AgentRegistry is Ownable, ReentrancyGuard {
    struct Agent {
        uint256 agentId;
        address owner;
        address wallet;          // USDC 收款地址
        string metadataCID;      // IPFS CID
        bytes32[] capabilityHashes;
        uint256 basePriceUsdc;   // 最低收费，6 decimals
        bool isActive;
        uint256 registeredAt;    // #6: renamed from createdAt
        uint256 updatedAt;
        uint256 totalTasks;
        uint256 reputationScore; // 0-500, 代表 0.00-5.00 分
    }

    uint256 private _agentIdCounter;

    // agentId => Agent
    mapping(uint256 => Agent) public agents;

    // address => agentId（一个地址只能注册一个 Agent）
    // #7: renamed from ownerToAgent to addressToAgentId
    mapping(address => uint256) public addressToAgentId;

    // capabilityHash => agentIds（能力索引，快速搜索）
    // #2: changed from private _capabilityToAgents to public capabilityIndex
    mapping(bytes32 => uint256[]) public capabilityIndex;

    // 所有活跃 Agent ID 列表
    uint256[] public activeAgentIds;

    // #8: AgentRegistered event parameters match doc spec
    event AgentRegistered(
        uint256 indexed agentId,
        address indexed owner,
        string metadataCID,
        uint256 timestamp
    );

    event AgentUpdated(uint256 indexed agentId, string newMetadataCID);
    event AvailabilityChanged(uint256 indexed agentId, bool isActive);
    event ReputationUpdated(uint256 indexed agentId, uint256 newScore);

    constructor() Ownable(msg.sender) {
        _agentIdCounter = 1;
    }

    /**
     * @notice 注册新 Agent
     */
    function register(
        address wallet,
        string calldata metadataCID,
        bytes32[] calldata capabilityHashes,
        uint256 basePriceUsdc,
        bool startActive
    ) external nonReentrant returns (uint256 agentId) {
        require(addressToAgentId[msg.sender] == 0, "Already registered");
        require(bytes(metadataCID).length > 0, "Empty metadata CID");
        // #1: added capability non-empty validation
        require(capabilityHashes.length > 0, "No capabilities");
        require(wallet != address(0), "Invalid wallet");

        agentId = _agentIdCounter++;

        agents[agentId] = Agent({
            agentId: agentId,
            owner: msg.sender,
            wallet: wallet,
            metadataCID: metadataCID,
            capabilityHashes: capabilityHashes,
            basePriceUsdc: basePriceUsdc,
            isActive: startActive,
            registeredAt: block.timestamp,  // #6: renamed
            updatedAt: block.timestamp,
            totalTasks: 0,
            reputationScore: 400  // 默认 4.00 分起步
        });

        addressToAgentId[msg.sender] = agentId;

        // 建立能力索引
        for (uint256 i = 0; i < capabilityHashes.length; i++) {
            capabilityIndex[capabilityHashes[i]].push(agentId);
        }

        if (startActive) {
            activeAgentIds.push(agentId);
        }

        // #8: emit with timestamp instead of wallet
        emit AgentRegistered(agentId, msg.sender, metadataCID, block.timestamp);
    }

    /**
     * @notice 更新 Agent 元数据（能力变更、定价调整等）
     */
    function updateMetadata(
        string calldata newMetadataCID,
        uint256 newBasePrice
    ) external {
        uint256 agentId = addressToAgentId[msg.sender];
        require(agentId != 0, "Not registered");

        agents[agentId].metadataCID = newMetadataCID;
        agents[agentId].basePriceUsdc = newBasePrice;
        agents[agentId].updatedAt = block.timestamp;

        emit AgentUpdated(agentId, newMetadataCID);
    }

    /**
     * @notice 设置 Agent 在线/离线状态
     */
    function setAvailability(bool isActive) external {
        uint256 agentId = addressToAgentId[msg.sender];
        require(agentId != 0, "Not registered");

        agents[agentId].isActive = isActive;
        agents[agentId].updatedAt = block.timestamp;

        if (isActive) {
            activeAgentIds.push(agentId);
        }

        emit AvailabilityChanged(agentId, isActive);
    }

    /**
     * @notice 按能力哈希搜索 Agent（供 Discovery 模块调用）
     */
    function getAgentsByCapability(bytes32 capabilityHash)
        external view returns (uint256[] memory)
    {
        return capabilityIndex[capabilityHash];
    }

    /**
     * @notice 获取 Agent 完整信息
     */
    function getAgent(uint256 agentId) external view returns (Agent memory) {
        require(agents[agentId].agentId != 0, "Agent not found");
        return agents[agentId];
    }

    /**
     * @notice 更新信誉分（只有 TaskEscrow 合约可以调用）
     * #3: changed third parameter from uint256 taskIncrement to bool incrementTaskCount
     */
    function updateReputation(
        uint256 agentId,
        uint256 newScore,
        bool incrementTaskCount
    ) external onlyTrustedContract {
        require(newScore <= 500, "Score out of range");
        agents[agentId].reputationScore = newScore;
        if (incrementTaskCount) {
            agents[agentId].totalTasks++;
        }
        agents[agentId].updatedAt = block.timestamp;
        emit ReputationUpdated(agentId, newScore);
    }

    // 信任合约白名单（TaskEscrow）
    mapping(address => bool) public trustedContracts;

    modifier onlyTrustedContract() {
        require(trustedContracts[msg.sender], "Not trusted");
        _;
    }

    function setTrustedContract(address addr, bool trusted) external onlyOwner {
        trustedContracts[addr] = trusted;
    }
}
