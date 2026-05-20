/**
 * RegistryService - manages agent registration, availability, and metadata.
 * Coordinates between on-chain AgentRegistry contract and off-chain cache/IPFS.
 *
 * #18: Enhanced metadata validation to cover all doc-spec fields.
 * #19: getAgentInfo returns nested onchain structure per doc spec.
 */

const { ethers } = require('ethers');
const { uploadToIPFS, fetchFromIPFS } = require('./ipfs.service');
const { getCache, setCache, CACHE_KEYS, syncOnChainEvent } = require('../config/redis.config');
const AgentRegistryABI = require('../abis/AgentRegistry.json');
const ArcNativeIdentityService = require('./arc-native-identity.service');

// Use doc-spec variable names with fallbacks for legacy names
const RPC_URL = process.env.ARC_RPC_URL || process.env.RPC_URL || 'https://rpc.testnet.arc.network';
const REGISTRY_ADDRESS = process.env.REGISTRY_CONTRACT || '';
const OPERATOR_KEY = process.env.DEPLOYER_PRIVATE_KEY || process.env.OPERATOR_PRIVATE_KEY || '';

// ERC-8004 cross-registration support
const arcIdentityService = new ArcNativeIdentityService();

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
   * #18: Full validation matching doc spec §3.1.1
   *
   * Required: name, capabilities (non-empty array), wallet, availability
   * Each capability must have: id/name, pricing with basePrice, currency
   * Availability must have: status
   */
  validateMetadata(metadata) {
    const errors = [];

    // Required top-level fields
    if (!metadata.name || typeof metadata.name !== 'string') {
      errors.push('name is required and must be a string');
    }
    if (!metadata.capabilities || !Array.isArray(metadata.capabilities) || metadata.capabilities.length === 0) {
      errors.push('capabilities must be a non-empty array');
    }
    if (!metadata.wallet && !metadata.endpoint) {
      // At least one contact method required
      errors.push('wallet or endpoint is required');
    }

    // Optional but validated if present
    if (metadata.version !== undefined && typeof metadata.version !== 'string') {
      errors.push('version must be a string');
    }
    if (metadata.description !== undefined && typeof metadata.description !== 'string') {
      errors.push('description must be a string');
    }

    // Validate each capability
    if (Array.isArray(metadata.capabilities)) {
      metadata.capabilities.forEach((cap, i) => {
        if (typeof cap === 'string') return; // Simple string capabilities are allowed

        if (!cap.name && !cap.id) {
          errors.push(`capabilities[${i}]: name or id is required`);
        }

        // Validate pricing if present
        if (cap.pricing) {
          if (cap.pricing.basePrice !== undefined) {
            const price = parseFloat(cap.pricing.basePrice);
            if (isNaN(price) || price < 0) {
              errors.push(`capabilities[${i}].pricing.basePrice must be a non-negative number`);
            }
          }
          if (cap.pricing.currency && cap.pricing.currency !== 'USDC') {
            errors.push(`capabilities[${i}].pricing.currency must be USDC`);
          }
        }

        // Validate inputSchema if present
        if (cap.inputSchema && typeof cap.inputSchema !== 'object') {
          errors.push(`capabilities[${i}].inputSchema must be an object`);
        }

        // Validate outputSchema if present
        if (cap.outputSchema && typeof cap.outputSchema !== 'object') {
          errors.push(`capabilities[${i}].outputSchema must be an object`);
        }
      });
    }

    // Validate availability if present
    if (metadata.availability) {
      if (typeof metadata.availability !== 'object') {
        errors.push('availability must be an object');
      } else {
        if (metadata.availability.status &&
            !['online', 'offline', 'busy'].includes(metadata.availability.status)) {
          errors.push('availability.status must be one of: online, offline, busy');
        }
        if (metadata.availability.uptime !== undefined &&
            (typeof metadata.availability.uptime !== 'number' || metadata.availability.uptime < 0 || metadata.availability.uptime > 100)) {
          errors.push('availability.uptime must be a number between 0 and 100');
        }
        if (metadata.availability.maxConcurrentTasks !== undefined &&
            (typeof metadata.availability.maxConcurrentTasks !== 'number' || metadata.availability.maxConcurrentTasks < 0)) {
          errors.push('availability.maxConcurrentTasks must be a non-negative number');
        }
      }
    }

    // Legacy field support
    if (metadata.pricePerTask !== undefined && (typeof metadata.pricePerTask !== 'number' || metadata.pricePerTask < 0)) {
      errors.push('pricePerTask must be a non-negative number');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Register a new agent.
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
      const capabilityHashes = (metadata.capabilities || []).map((cap) => {
        const capId = typeof cap === 'string' ? cap : (cap.id || cap.name || '');
        return ethers.keccak256(ethers.toUtf8Bytes(capId));
      });

      // Extract base price from capabilities or top-level field
      let basePrice = 0;
      if (metadata.capabilities?.[0]?.pricing?.basePrice) {
        basePrice = parseFloat(metadata.capabilities[0].pricing.basePrice);
      } else if (metadata.pricePerTask) {
        basePrice = metadata.pricePerTask;
      }

      const basePriceUsdc = ethers.parseUnits(String(basePrice), 6);
      const startActive = metadata.availability?.status === 'online' || true;

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
        reputationScore: 400,
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
      reputationScore: 400,
      available: true,
      registeredAt: new Date().toISOString(),
    };

    this._store.set(agentId, agentData);
    await syncOnChainEvent('AgentRegistered', agentData);

    // Cross-register on ERC-8004 IdentityRegistry (non-blocking)
    this._crossRegisterERC8004(metadata, walletAddress).catch((err) => {
      console.warn(`[Registry] ERC-8004 cross-registration skipped:`, err.message);
    });

    return agentData;
  }

  /**
   * Update agent availability status.
   */
  async updateAvailability(agentId, isOnline) {
    if (this.contract && this.signer) {
      const tx = await this.contract.setAvailability(isOnline);
      const receipt = await tx.wait();
      await syncOnChainEvent('AvailabilityChanged', { agentId, available: isOnline });
      return { agentId, isOnline, txHash: receipt.hash };
    }

    // Dev fallback
    const agent = this._store.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    agent.available = isOnline;
    await syncOnChainEvent('AvailabilityChanged', { agentId, available: isOnline });
    return { agentId, isOnline };
  }

  /**
   * Get agent information by ID.
   * #19: Returns nested onchain structure per doc spec §3.1.2
   */
  async getAgentInfo(agentId) {
    // Check cache first
    const cached = getCache(`${CACHE_KEYS.AGENT_PREFIX}${agentId}`);
    if (cached && cached.onchain) return cached;

    if (this.contract) {
      const raw = await this.contract.getAgent(agentId);
      let metadata = {};
      try {
        metadata = await fetchFromIPFS(raw.metadataCID);
      } catch (err) {
        console.warn(`[Registry] Failed to fetch IPFS metadata for agent ${agentId}:`, err.message);
      }

      // #19: Return structure matching doc spec with nested onchain object
      const agentData = {
        agentId: raw.agentId.toString(),
        name: metadata.name || `Agent-${agentId}`,
        description: metadata.description || '',
        capabilities: metadata.capabilities || [],
        reputation: {
          score: Number(raw.reputationScore) / 100,
          totalTasks: Number(raw.totalTasks),
          successRate: metadata.reputation?.successRate || 0.95,
        },
        availability: metadata.availability || {
          status: raw.isActive ? 'online' : 'offline',
        },
        wallet: raw.wallet,
        endpoint: metadata.endpoint || '',
        onchain: {
          agentId: raw.agentId.toString(),
          owner: raw.owner,
          registeredAt: new Date(Number(raw.registeredAt) * 1000).toISOString(),
          isActive: raw.isActive,
          totalTasks: raw.totalTasks.toString(),
          reputationScore: Number(raw.reputationScore) / 100,
        },
        metadata,
        metadataURI: raw.metadataCID,
      };

      setCache(`${CACHE_KEYS.AGENT_PREFIX}${agentId}`, agentData, 300);
      return agentData;
    }

    // Dev fallback - restructure to match doc spec
    const agent = this._store.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);

    return {
      agentId: agent.agentId,
      name: agent.metadata?.name || `Agent-${agentId}`,
      description: agent.metadata?.description || '',
      capabilities: agent.capabilities || [],
      reputation: {
        score: (agent.reputationScore || 400) / 100,
        totalTasks: agent.totalTasks || 0,
        successRate: 0.95,
      },
      availability: agent.metadata?.availability || {
        status: agent.available ? 'online' : 'offline',
      },
      wallet: agent.walletAddress,
      endpoint: agent.metadata?.endpoint || '',
      onchain: {
        agentId: agent.agentId,
        owner: agent.walletAddress,
        registeredAt: agent.registeredAt,
        isActive: agent.available !== false,
        totalTasks: String(agent.totalTasks || 0),
        reputationScore: (agent.reputationScore || 400) / 100,
      },
      metadata: agent.metadata,
      metadataURI: agent.metadataURI,
    };
  }

  /**
   * Get all active (available) agents.
   */
  async getAllActiveAgents() {
    if (this.contract) {
      const cachedList = getCache(CACHE_KEYS.AGENT_LIST);
      if (cachedList && cachedList.length > 0) {
        const agents = await Promise.all(
          cachedList.map((id) => this.getAgentInfo(id).catch(() => null))
        );
        return agents.filter((a) => a && a.onchain?.isActive !== false);
      }

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
    return Array.from(this._store.values())
      .filter((a) => a.available)
      .map((a) => this._formatAgent(a));
  }

  /**
   * Cross-register agent on ERC-8004 IdentityRegistry.
   * Non-blocking - failures are logged but do not break the main registration.
   * @param {object} metadata - Agent metadata.
   * @param {string} walletAddress - Agent wallet address.
   * @private
   */
  async _crossRegisterERC8004(metadata, walletAddress) {
    const capabilitySchemas = (metadata.capabilities || []).map((cap) => {
      if (typeof cap === 'string') return { name: cap };
      return cap;
    });

    const result = await arcIdentityService.registerAgentOnChain({
      name: metadata.name,
      description: metadata.description || '',
      capabilitySchemas,
      pricingModel: metadata.capabilities?.[0]?.pricing || { type: 'per_task', basePrice: 0, currency: 'USDC' },
      availabilityEndpoint: metadata.endpoint || '',
      wallet: walletAddress,
    });

    console.log(`[Registry] ERC-8004 cross-registration successful: agentId=${result.agentId}`);
    return result;
  }

  /**
   * Format dev-mode agent to match doc spec.
   * @private
   */
  _formatAgent(agent) {
    return {
      agentId: agent.agentId,
      name: agent.metadata?.name || `Agent-${agent.agentId}`,
      capabilities: agent.capabilities || [],
      reputation: {
        score: (agent.reputationScore || 400) / 100,
        totalTasks: agent.totalTasks || 0,
        successRate: 0.95,
      },
      availability: agent.metadata?.availability || { status: 'online' },
      wallet: agent.walletAddress,
      onchain: {
        agentId: agent.agentId,
        owner: agent.walletAddress,
        registeredAt: agent.registeredAt,
        isActive: true,
        totalTasks: '0',
        reputationScore: (agent.reputationScore || 400) / 100,
      },
      metadata: agent.metadata,
    };
  }
}

module.exports = RegistryService;
