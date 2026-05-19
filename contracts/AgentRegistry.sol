// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract AgentRegistry is Ownable, ReentrancyGuard {
    struct Agent {
        uint256 agentId;
        address owner;
        address wallet;
        string metadataCID;
        bytes32[] capabilityHashes;
        uint256 basePriceUsdc;
        bool isActive;
        uint256 createdAt;
        uint256 updatedAt;
        uint256 totalTasks;
        uint256 reputationScore;
    }

    uint256 private _agentIdCounter = 1;

    // agentId => Agent
    mapping(uint256 => Agent) public agents;
    // owner => agentId
    mapping(address => uint256) public ownerToAgent;
    // capabilityHash => agentId[]
    mapping(bytes32 => uint256[]) private _capabilityToAgents;
    // trusted contracts (e.g. TaskEscrow) allowed to call updateReputation
    mapping(address => bool) public trustedContracts;

    event AgentRegistered(uint256 indexed agentId, address indexed owner, address wallet, string metadataCID);
    event AgentUpdated(uint256 indexed agentId, string metadataCID);
    event AvailabilityChanged(uint256 indexed agentId, bool isActive);
    event ReputationUpdated(uint256 indexed agentId, uint256 newScore);

    modifier onlyTrustedContract() {
        require(trustedContracts[msg.sender], "AgentRegistry: caller is not a trusted contract");
        _;
    }

    constructor() Ownable(msg.sender) {}

    function setTrustedContract(address _contract, bool _trusted) external onlyOwner {
        trustedContracts[_contract] = _trusted;
    }

    function register(
        address wallet,
        string calldata metadataCID,
        bytes32[] calldata capabilityHashes,
        uint256 basePriceUsdc,
        bool startActive
    ) external nonReentrant returns (uint256) {
        require(ownerToAgent[msg.sender] == 0, "AgentRegistry: already registered");
        require(wallet != address(0), "AgentRegistry: zero wallet address");
        require(bytes(metadataCID).length > 0, "AgentRegistry: empty metadataCID");

        uint256 agentId = _agentIdCounter++;

        Agent storage agent = agents[agentId];
        agent.agentId = agentId;
        agent.owner = msg.sender;
        agent.wallet = wallet;
        agent.metadataCID = metadataCID;
        agent.capabilityHashes = capabilityHashes;
        agent.basePriceUsdc = basePriceUsdc;
        agent.isActive = startActive;
        agent.createdAt = block.timestamp;
        agent.updatedAt = block.timestamp;
        agent.totalTasks = 0;
        agent.reputationScore = 400;

        ownerToAgent[msg.sender] = agentId;

        for (uint256 i = 0; i < capabilityHashes.length; i++) {
            _capabilityToAgents[capabilityHashes[i]].push(agentId);
        }

        emit AgentRegistered(agentId, msg.sender, wallet, metadataCID);
        return agentId;
    }

    function updateMetadata(string calldata metadataCID) external {
        uint256 agentId = ownerToAgent[msg.sender];
        require(agentId != 0, "AgentRegistry: not registered");
        require(bytes(metadataCID).length > 0, "AgentRegistry: empty metadataCID");

        agents[agentId].metadataCID = metadataCID;
        agents[agentId].updatedAt = block.timestamp;

        emit AgentUpdated(agentId, metadataCID);
    }

    function setAvailability(bool _isActive) external {
        uint256 agentId = ownerToAgent[msg.sender];
        require(agentId != 0, "AgentRegistry: not registered");

        agents[agentId].isActive = _isActive;
        agents[agentId].updatedAt = block.timestamp;

        emit AvailabilityChanged(agentId, _isActive);
    }

    function updateReputation(uint256 agentId, uint256 newScore, uint256 taskIncrement) external onlyTrustedContract {
        require(agents[agentId].agentId != 0, "AgentRegistry: agent does not exist");

        agents[agentId].reputationScore = newScore;
        agents[agentId].totalTasks += taskIncrement;
        agents[agentId].updatedAt = block.timestamp;

        emit ReputationUpdated(agentId, newScore);
    }

    function getAgent(uint256 agentId) external view returns (Agent memory) {
        require(agents[agentId].agentId != 0, "AgentRegistry: agent does not exist");
        return agents[agentId];
    }

    function getAgentsByCapability(bytes32 capabilityHash) external view returns (uint256[] memory) {
        return _capabilityToAgents[capabilityHash];
    }
}
