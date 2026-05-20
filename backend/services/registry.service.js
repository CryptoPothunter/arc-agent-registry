/**
 * RegistryService - manages agent registration, availability, and metadata.
 * Coordinates between on-chain AgentRegistry contract and off-chain cache/IPFS.
 */

const { ethers } = require('ethers');
const { uploadToIPFS, fetchFromIPFS } = require('./ipfs.service');
const { getCache, setCache, CACHE_KEYS, syncOnChainEvent } = require('../config/redis.config');
const AgentRegistryABI = require('../abis/AgentRegistry.json');

const RPC_URL = process.env.RPC_URL || 'https://rpc.testnet.arc.network';
const REGISTRY_ADDRESS = process.env.REGISTRY_CONTRACT || '';
const OPERATOR_KEY = process.env.OPERATOR_PRIVATE_KEY || '';

class RegistryService {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(RPC_URL);
    this.signer = OPERATOR_KEY
      ? new ethers.Wallet(OPERATOR_KEY, this.provider)
      : null;
    this.contract = REGISTRY_ADDRESS
      ? new ethers.Contract(REGISTRY_ADDRESS, AgentRegistryABI, this.signer || this.provider)
      : null;
    // In-memory fallback store for dev mode (no contract deployed)
    this._store = new Map();
    this._nextId = 1;
  }

  /**
   * Validate agent metadata before registration.
   * @param {object} metadata
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validateMetadata(metadata) {
    const errors = [];
    if (!metadata.name || typeof metadata.name !== 'string') {
      errors.push('name is required and must be a string');
    }
    if (!metadata.capabilities || !Array.isArray(metadata.capabilities) || metadata.capabilities.length === 0) {
      errors.push('capabilities must be a non-empty array');
    }
    if (metadata.pricePerTask !== undefined && (typeof metadata.pricePerTask !== 'number' || metadata.pricePerTask < 0)) {
      errors.push('pricePerTask must be a non-negative number');
    }
    if (!metadata.endpoint || typeof metadata.endpoint !== 'string') {
      errors.push('endpoint is required and must be a string');
    }
    return { valid: errors.length === 0, errors };
  }

  /**
   * Register a new agent.
   * @param {object} params
   * @param {object} params.metadata - Agent metadata (name, capabilities, endpoint, pricePerTask, description).
   * @param {string} params.walletAddress - Agent wallet address.
   * @returns {Promise<object>} Registered agent details.
   */
  async registerAgent({ metadata, walletAddress }) {
    const validation = this.validateMetadata(metadata);
    if (!validation.valid) {
      throw new Error(`Invalid metadata: ${validation.errors.join(', ')}`);
    }

    // Upload metadata to IPFS
    const metadataURI = await uploadToIPFS(metadata);

    if (this.contract && this.signer) {
      // On-chain registration
      // Convert capabilities to bytes32 hashes
      const capabilityHashes = metadata.capabilities.map((cap) =>
        ethers.keccak256(ethers.toUtf8Bytes(cap))
      );
      const basePriceUsdc = ethers.parseUnits(
        String(metadata.pricePerTask || 0),
        6
      );
      const startActive = true;

      const tx = await this.contract.register(
        walletAddress,
        metadataURI,
        capabilityHashes,
        basePriceUsdc,
        startActive
      );
      const receipt = await tx.wait();

      // Parse AgentRegistered event
      const iface = new ethers.Interface(AgentRegistryABI);
      const log = receipt.logs.find((l) => {
        try {
          return iface.parseLog({ topics: l.topics, data: l.data })?.name === 'AgentRegistered';
        } catch {
          return false;
        }
      });

      const parsedEvent = log ? iface.parseLog({ topics: log.topics, data: log.data }) : null;
      const agentId = parsedEvent ? parsedEvent.args.agentId.toString() : 'unknown';

      const agentData = {
        agentId,
        metadataURI,
        walletAddress,
        metadata,
        capabilities: metadata.capabilities,
        reputationScore: 0,
        available: true,
        registeredAt: new Date().toISOString(),
        txHash: receipt.hash,
      };

      await syncOnChainEvent('AgentRegistered', agentData);
      return agentData;
    }

    // Dev fallback: in-memory registration
    const agentId = String(this._nextId++);
    const agentData = {
      agentId,
      metadataURI,
      walletAddress,
      metadata,
      capabilities: metadata.capabilities,
      reputationScore: 0,
      available: true,
      registeredAt: new Date().toISOString(),
    };

    this._store.set(agentId, agentData);
    await syncOnChainEvent('AgentRegistered', agentData);
    return agentData;
  }

  /**
   * Update agent availability status.
   * @param {string} agentId
   * @param {boolean} available
   * @returns {Promise<object>}
   */
  async updateAvailability(agentId, available) {
    if (this.contract && this.signer) {
      const tx = await this.contract.setAvailability(available);
      const receipt = await tx.wait();
      await syncOnChainEvent('AvailabilityChanged', { agentId, available });
      return { agentId, available, txHash: receipt.hash };
    }

    // Dev fallback
    const agent = this._store.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    agent.available = available;
    await syncOnChainEvent('AvailabilityChanged', { agentId, available });
    return { agentId, available };
  }

  /**
   * Get agent information by ID.
   * @param {string} agentId
   * @returns {Promise<object>}
   */
  async getAgentInfo(agentId) {
    // Check cache first
    const cached = getCache(`${CACHE_KEYS.AGENT_PREFIX}${agentId}`);
    if (cached) return cached;

    if (this.contract) {
      const raw = await this.contract.getAgent(agentId);
      let metadata = {};
      try {
        metadata = await fetchFromIPFS(raw.metadataCID);
      } catch (err) {
        console.warn(`[Registry] Failed to fetch IPFS metadata for agent ${agentId}:`, err.message);
      }

      const agentData = {
        agentId: raw.agentId.toString(),
        owner: raw.wallet,
        metadataURI: raw.metadataCID,
        walletAddress: raw.wallet,
        capabilities: Array.from(raw.capabilityHashes),
        reputationScore: Number(raw.reputationScore),
        available: raw.isActive,
        basePriceUsdc: ethers.formatUnits(raw.basePriceUsdc, 6),
        taskCount: Number(raw.taskCount),
        metadata,
      };

      setCache(`${CACHE_KEYS.AGENT_PREFIX}${agentId}`, agentData, 60);
      return agentData;
    }

    // Dev fallback
    const agent = this._store.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    return agent;
  }

  /**
   * Get all active (available) agents.
   * @returns {Promise<object[]>}
   */
  async getAllActiveAgents() {
    if (this.contract) {
      // Read from cache first
      const cachedList = getCache(CACHE_KEYS.AGENT_LIST);
      if (cachedList && cachedList.length > 0) {
        const agents = await Promise.all(
          cachedList.map((id) => this.getAgentInfo(id).catch(() => null))
        );
        return agents.filter((a) => a && a.available);
      }

      // Read active agent IDs directly from the contract's activeAgentIds array
      const agents = [];
      try {
        for (let i = 0; ; i++) {
          const agentId = await this.contract.activeAgentIds(i);
          const agent = await this.getAgentInfo(agentId.toString()).catch(() => null);
          if (agent) agents.push(agent);
        }
      } catch {
        // Array index out of bounds signals end of array
      }
      return agents;
    }

    // Dev fallback
    return Array.from(this._store.values()).filter((a) => a.available);
  }
}

module.exports = RegistryService;
