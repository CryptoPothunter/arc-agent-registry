// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAgentRegistryForPipeline {
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
 * @title AgentPipeline
 * @notice DAG-based task orchestration across multiple AI Agents
 * @dev Decomposes complex tasks into sub-tasks with dependency tracking,
 *      auto-settles each node upon completion
 */
contract AgentPipeline is ReentrancyGuard {

    IERC20 public immutable usdc;
    IAgentRegistryForPipeline public immutable registry;
    address public owner;

    enum NodeStatus { Pending, Running, Completed, Failed }

    struct PipelineNode {
        uint256 agentId;
        uint256[] dependencies;
        uint256 allocatedBudget;
        bytes32 deliverableHash;
        NodeStatus status;
    }

    struct PipelineInfo {
        uint256 pipelineId;
        address requester;
        uint256 totalBudget;
        uint256 orchestratorAgentId;
        uint256 nodeCount;
        bool completed;
        bytes32 finalDeliverableHash;
        string taskSpecUri;
        uint256 createdAt;
    }

    mapping(uint256 => PipelineInfo) public pipelines;
    mapping(uint256 => mapping(uint256 => PipelineNode)) public pipelineNodes;
    // Store dependencies separately since nested arrays in mappings need special handling
    mapping(uint256 => mapping(uint256 => uint256[])) internal nodeDependencies;
    uint256 public nextPipelineId = 1;

    uint256 public orchestratorFeeBps = 1000; // 10%

    event PipelineCreated(uint256 indexed pipelineId, address requester, uint256 totalBudget, string taskSpecUri);
    event DAGSubmitted(uint256 indexed pipelineId, uint256 nodeCount);
    event NodeStatusChanged(uint256 indexed pipelineId, uint256 nodeId, NodeStatus status);
    event NodeCompleted(uint256 indexed pipelineId, uint256 nodeId, bytes32 deliverableHash);
    event PipelineCompleted(uint256 indexed pipelineId, bytes32 finalDeliverable);
    event PipelineFailed(uint256 indexed pipelineId, uint256 failedNodeId);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyOrchestrator(uint256 pipelineId) {
        PipelineInfo storage p = pipelines[pipelineId];
        IAgentRegistryForPipeline.Agent memory agent = registry.getAgent(p.orchestratorAgentId);
        require(msg.sender == agent.wallet || msg.sender == agent.owner, "Not orchestrator");
        _;
    }

    constructor(address _usdc, address _registry) {
        usdc = IERC20(_usdc);
        registry = IAgentRegistryForPipeline(_registry);
        owner = msg.sender;
    }

    function createPipeline(
        uint256 orchestratorAgentId,
        uint256 totalBudget,
        string calldata taskSpecUri
    ) external nonReentrant returns (uint256 pipelineId) {
        require(totalBudget > 0, "Budget must be > 0");
        require(usdc.transferFrom(msg.sender, address(this), totalBudget), "Transfer failed");

        pipelineId = nextPipelineId++;
        pipelines[pipelineId] = PipelineInfo({
            pipelineId: pipelineId,
            requester: msg.sender,
            totalBudget: totalBudget,
            orchestratorAgentId: orchestratorAgentId,
            nodeCount: 0,
            completed: false,
            finalDeliverableHash: bytes32(0),
            taskSpecUri: taskSpecUri,
            createdAt: block.timestamp
        });

        emit PipelineCreated(pipelineId, msg.sender, totalBudget, taskSpecUri);
    }

    function submitDAG(
        uint256 pipelineId,
        uint256[] calldata agentIds,
        uint256[][] calldata dependencies,
        uint256[] calldata budgets
    ) external onlyOrchestrator(pipelineId) {
        PipelineInfo storage pipeline = pipelines[pipelineId];
        require(!pipeline.completed, "Already completed");
        require(pipeline.nodeCount == 0, "DAG already submitted");
        require(agentIds.length == dependencies.length, "Array length mismatch");
        require(agentIds.length == budgets.length, "Array length mismatch");
        require(agentIds.length > 0, "Empty DAG");

        uint256 totalAllocated;
        for (uint256 i = 0; i < agentIds.length; i++) {
            pipelineNodes[pipelineId][i] = PipelineNode({
                agentId: agentIds[i],
                dependencies: dependencies[i],
                allocatedBudget: budgets[i],
                deliverableHash: bytes32(0),
                status: NodeStatus.Pending
            });
            nodeDependencies[pipelineId][i] = dependencies[i];
            totalAllocated += budgets[i];
        }

        // Max 90% allocated to nodes, 10% is orchestrator fee
        require(totalAllocated <= pipeline.totalBudget * 90 / 100, "Budget overflow (max 90%)");
        pipeline.nodeCount = agentIds.length;

        emit DAGSubmitted(pipelineId, agentIds.length);
    }

    function startNode(uint256 pipelineId, uint256 nodeId)
        external onlyOrchestrator(pipelineId)
    {
        PipelineNode storage node = pipelineNodes[pipelineId][nodeId];
        require(node.status == NodeStatus.Pending, "Node not pending");

        // Check all dependencies are completed
        uint256[] storage deps = nodeDependencies[pipelineId][nodeId];
        for (uint256 i = 0; i < deps.length; i++) {
            require(
                pipelineNodes[pipelineId][deps[i]].status == NodeStatus.Completed,
                "Dependency not complete"
            );
        }

        node.status = NodeStatus.Running;
        emit NodeStatusChanged(pipelineId, nodeId, NodeStatus.Running);
    }

    function completeNode(
        uint256 pipelineId,
        uint256 nodeId,
        bytes32 deliverableHash
    ) external nonReentrant {
        PipelineInfo storage pipeline = pipelines[pipelineId];
        require(!pipeline.completed, "Pipeline completed");
        require(nodeId < pipeline.nodeCount, "Invalid node");

        PipelineNode storage node = pipelineNodes[pipelineId][nodeId];
        IAgentRegistryForPipeline.Agent memory agent = registry.getAgent(node.agentId);
        require(msg.sender == agent.wallet || msg.sender == agent.owner, "Not node agent");
        require(node.status == NodeStatus.Running, "Node not running");

        node.deliverableHash = deliverableHash;
        node.status = NodeStatus.Completed;

        // Pay the agent
        if (node.allocatedBudget > 0) {
            require(usdc.transfer(agent.wallet, node.allocatedBudget), "Payment failed");
        }

        emit NodeCompleted(pipelineId, nodeId, deliverableHash);

        // Check if all nodes completed
        bool allDone = true;
        for (uint256 i = 0; i < pipeline.nodeCount; i++) {
            if (pipelineNodes[pipelineId][i].status != NodeStatus.Completed) {
                allDone = false;
                break;
            }
        }

        if (allDone) {
            pipeline.completed = true;
            pipeline.finalDeliverableHash = deliverableHash;

            // Pay orchestrator fee (remaining balance)
            uint256 remaining = usdc.balanceOf(address(this));
            IAgentRegistryForPipeline.Agent memory orchestrator = registry.getAgent(pipeline.orchestratorAgentId);
            uint256 orchestratorFee = pipeline.totalBudget * orchestratorFeeBps / 10000;
            if (orchestratorFee > 0 && remaining >= orchestratorFee) {
                usdc.transfer(orchestrator.wallet, orchestratorFee);
            }

            emit PipelineCompleted(pipelineId, deliverableHash);
        }
    }

    function failNode(uint256 pipelineId, uint256 nodeId)
        external onlyOrchestrator(pipelineId)
    {
        PipelineNode storage node = pipelineNodes[pipelineId][nodeId];
        require(node.status == NodeStatus.Running, "Node not running");
        node.status = NodeStatus.Failed;
        emit NodeStatusChanged(pipelineId, nodeId, NodeStatus.Failed);
        emit PipelineFailed(pipelineId, nodeId);
    }

    function retryNode(uint256 pipelineId, uint256 nodeId, uint256 newAgentId)
        external onlyOrchestrator(pipelineId)
    {
        PipelineNode storage node = pipelineNodes[pipelineId][nodeId];
        require(node.status == NodeStatus.Failed, "Node not failed");
        node.agentId = newAgentId;
        node.status = NodeStatus.Pending;
        emit NodeStatusChanged(pipelineId, nodeId, NodeStatus.Pending);
    }

    // --- View functions ---

    function getPipeline(uint256 pipelineId) external view returns (PipelineInfo memory) {
        return pipelines[pipelineId];
    }

    function getNode(uint256 pipelineId, uint256 nodeId) external view returns (
        uint256 agentId,
        uint256 allocatedBudget,
        bytes32 deliverableHash,
        NodeStatus status,
        uint256[] memory dependencies
    ) {
        PipelineNode storage node = pipelineNodes[pipelineId][nodeId];
        return (
            node.agentId,
            node.allocatedBudget,
            node.deliverableHash,
            node.status,
            nodeDependencies[pipelineId][nodeId]
        );
    }

    function getPipelineProgress(uint256 pipelineId) external view returns (
        uint256 total,
        uint256 completed,
        uint256 running,
        uint256 failed,
        uint256 pending
    ) {
        PipelineInfo storage pipeline = pipelines[pipelineId];
        total = pipeline.nodeCount;
        for (uint256 i = 0; i < total; i++) {
            NodeStatus s = pipelineNodes[pipelineId][i].status;
            if (s == NodeStatus.Completed) completed++;
            else if (s == NodeStatus.Running) running++;
            else if (s == NodeStatus.Failed) failed++;
            else pending++;
        }
    }

    // --- Admin ---

    function setOrchestratorFee(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= 2000, "Max 20%");
        orchestratorFeeBps = newFeeBps;
    }

    /**
     * @notice Emergency refund if pipeline is stuck
     */
    function emergencyRefund(uint256 pipelineId) external onlyOwner {
        PipelineInfo storage pipeline = pipelines[pipelineId];
        require(!pipeline.completed, "Already completed");
        pipeline.completed = true;

        uint256 refundAmount;
        for (uint256 i = 0; i < pipeline.nodeCount; i++) {
            if (pipelineNodes[pipelineId][i].status != NodeStatus.Completed) {
                refundAmount += pipelineNodes[pipelineId][i].allocatedBudget;
            }
        }

        if (refundAmount > 0) {
            usdc.transfer(pipeline.requester, refundAmount);
        }
    }
}
