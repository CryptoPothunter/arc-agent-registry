/**
 * ArcNativeIdentityService - Integration with ERC-8004 IdentityRegistry
 * and ERC-8183 AgenticCommerce contracts on Arc Testnet.
 *
 * Registers agents on ERC-8004 with extended metadata (capability schemas,
 * pricing model, availability endpoint). Creates ERC-8183 Jobs for task settlement.
 */

const { ethers } = require('ethers');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RPC_URL = process.env.ARC_RPC_URL || process.env.RPC_URL || 'https://rpc.testnet.arc.network';
const IDENTITY_REGISTRY_ADDRESS = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const AGENTIC_COMMERCE_ADDRESS = '0x0747EEf0706327138c69792bF28Cd525089e4583';
const WALLET_A_KEY = process.env.WALLET_A_PRIVATE_KEY || '';
const WALLET_B_KEY = process.env.WALLET_B_PRIVATE_KEY || '';

// Minimal ABI for ERC-8004 IdentityRegistry
const IDENTITY_REGISTRY_ABI = [
  'function registerAgent(address agentAddress, string metadataURI) external returns (uint256 agentId)',
  'function updateMetadata(uint256 agentId, string metadataURI) external',
  'function getAgent(uint256 agentId) external view returns (address agentAddress, string metadataURI, bool isActive, uint256 registeredAt)',
  'function deactivateAgent(uint256 agentId) external',
  'event AgentRegistered(uint256 indexed agentId, address indexed agentAddress, string metadataURI)',
];

// Minimal ABI for ERC-8183 AgenticCommerce
const AGENTIC_COMMERCE_ABI = [
  'function createJob(uint256 providerAgentId, uint256 clientAgentId, string taskDescriptionURI, uint256 paymentAmount, uint256 deadline) external returns (uint256 jobId)',
  'function completeJob(uint256 jobId, string resultURI) external',
  'function cancelJob(uint256 jobId) external',
  'function getJob(uint256 jobId) external view returns (uint256 providerAgentId, uint256 clientAgentId, string taskDescriptionURI, uint256 paymentAmount, uint256 deadline, uint8 status, string resultURI)',
  'event JobCreated(uint256 indexed jobId, uint256 indexed providerAgentId, uint256 indexed clientAgentId, uint256 paymentAmount)',
  'event JobCompleted(uint256 indexed jobId, string resultURI)',
];

// Local IPFS simulation directory
const LOCAL_IPFS_DIR = path.join(__dirname, '..', '.ipfs-local');

class ArcNativeIdentityService {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(RPC_URL);

    // Wallet A is the primary operator
    this.signerA = WALLET_A_KEY
      ? new ethers.Wallet(WALLET_A_KEY, this.provider)
      : null;
    // Wallet B for secondary operations (e.g., client-side job creation)
    this.signerB = WALLET_B_KEY
      ? new ethers.Wallet(WALLET_B_KEY, this.provider)
      : null;

    this.identityContract = this.signerA
      ? new ethers.Contract(IDENTITY_REGISTRY_ADDRESS, IDENTITY_REGISTRY_ABI, this.signerA)
      : null;
    this.commerceContract = this.signerA
      ? new ethers.Contract(AGENTIC_COMMERCE_ADDRESS, AGENTIC_COMMERCE_ABI, this.signerA)
      : null;

    // Dev fallback stores
    this._agentStore = new Map();
    this._jobStore = new Map();
    this._nextAgentId = 1;
    this._nextJobId = 1;
  }

  /**
   * Simulate IPFS upload by storing locally (dev mode).
   * @param {object} data - JSON data to store.
   * @returns {string} Simulated CID.
   * @private
   */
  _simulateIpfsUpload(data) {
    if (!fs.existsSync(LOCAL_IPFS_DIR)) {
      fs.mkdirSync(LOCAL_IPFS_DIR, { recursive: true });
    }

    const contentHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex');
    const cid = `QmNativeId${contentHash.slice(0, 36)}`;
    const filePath = path.join(LOCAL_IPFS_DIR, `${cid}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`[ArcNativeIdentity] IPFS simulated upload: ${cid}`);
    return cid;
  }

  /**
   * Register an agent on ERC-8004 IdentityRegistry with extended metadata.
   * @param {object} params
   * @param {string} params.name - Agent name.
   * @param {string} params.description - Agent description.
   * @param {Array} params.capabilitySchemas - Array of capability schema objects.
   * @param {object} params.pricingModel - Pricing model object (e.g., { type: 'per_task', basePrice: 1.5, currency: 'USDC' }).
   * @param {string} params.availabilityEndpoint - URL for checking agent availability.
   * @param {string} [params.wallet] - Optional wallet override (defaults to signerA address).
   * @returns {Promise<object>} Registration result.
   */
  async registerAgentOnChain({ name, description, capabilitySchemas, pricingModel, availabilityEndpoint, wallet }) {
    try {
      // Build extended metadata
      const metadata = {
        name,
        description,
        capabilitySchemas: capabilitySchemas || [],
        pricingModel: pricingModel || { type: 'per_task', basePrice: 0, currency: 'USDC' },
        availabilityEndpoint: availabilityEndpoint || '',
        registeredAt: new Date().toISOString(),
        standard: 'ERC-8004',
      };

      // Upload metadata to IPFS (simulated in dev mode)
      const metadataURI = this._simulateIpfsUpload(metadata);

      if (this.identityContract && this.signerA) {
        const agentAddress = wallet || (await this.signerA.getAddress());
        console.log(`[ArcNativeIdentity] Registering agent "${name}" on ERC-8004...`);

        const tx = await this.identityContract.registerAgent(agentAddress, metadataURI);
        const receipt = await tx.wait();

        // Parse AgentRegistered event
        const iface = new ethers.Interface(IDENTITY_REGISTRY_ABI);
        let agentId = 'unknown';
        for (const log of receipt.logs) {
          try {
            const parsed = iface.parseLog({ topics: log.topics, data: log.data });
            if (parsed && parsed.name === 'AgentRegistered') {
              agentId = parsed.args.agentId.toString();
              break;
            }
          } catch {
            // Not our event, skip
          }
        }

        console.log(`[ArcNativeIdentity] Agent registered on-chain: agentId=${agentId}, tx=${receipt.hash}`);

        return {
          agentId,
          name,
          metadataURI,
          wallet: agentAddress,
          txHash: receipt.hash,
          standard: 'ERC-8004',
          contract: IDENTITY_REGISTRY_ADDRESS,
          registeredAt: metadata.registeredAt,
        };
      }

      // Dev fallback: in-memory registration
      const agentId = String(this._nextAgentId++);
      const agentAddress = wallet || '0x0000000000000000000000000000000000000001';
      const agentData = {
        agentId,
        name,
        metadataURI,
        wallet: agentAddress,
        metadata,
        isActive: true,
        standard: 'ERC-8004',
        contract: IDENTITY_REGISTRY_ADDRESS,
        registeredAt: metadata.registeredAt,
      };

      this._agentStore.set(agentId, agentData);
      console.log(`[ArcNativeIdentity] Agent registered (dev mode): agentId=${agentId}`);
      return agentData;
    } catch (err) {
      console.error(`[ArcNativeIdentity] Registration failed:`, err.message);
      throw new Error(`ERC-8004 registration failed: ${err.message}`);
    }
  }

  /**
   * Update agent metadata on ERC-8004.
   * @param {string} agentId - On-chain agent ID.
   * @param {object} updatedMetadata - New metadata fields to merge.
   * @returns {Promise<object>} Update result.
   */
  async updateAgentMetadata(agentId, updatedMetadata) {
    try {
      const metadataURI = this._simulateIpfsUpload(updatedMetadata);

      if (this.identityContract && this.signerA) {
        console.log(`[ArcNativeIdentity] Updating metadata for agent ${agentId}...`);
        const tx = await this.identityContract.updateMetadata(agentId, metadataURI);
        const receipt = await tx.wait();

        console.log(`[ArcNativeIdentity] Metadata updated: tx=${receipt.hash}`);
        return { agentId, metadataURI, txHash: receipt.hash, updatedAt: new Date().toISOString() };
      }

      // Dev fallback
      const agent = this._agentStore.get(agentId);
      if (!agent) throw new Error(`Agent ${agentId} not found`);
      agent.metadataURI = metadataURI;
      agent.metadata = { ...agent.metadata, ...updatedMetadata };
      console.log(`[ArcNativeIdentity] Metadata updated (dev mode): agentId=${agentId}`);
      return { agentId, metadataURI, updatedAt: new Date().toISOString() };
    } catch (err) {
      console.error(`[ArcNativeIdentity] Metadata update failed:`, err.message);
      throw new Error(`ERC-8004 metadata update failed: ${err.message}`);
    }
  }

  /**
   * Get agent information from ERC-8004.
   * @param {string} agentId - On-chain agent ID.
   * @returns {Promise<object>} Agent info.
   */
  async getAgentIdentity(agentId) {
    try {
      if (this.identityContract) {
        const raw = await this.identityContract.getAgent(agentId);
        return {
          agentId,
          agentAddress: raw.agentAddress,
          metadataURI: raw.metadataURI,
          isActive: raw.isActive,
          registeredAt: new Date(Number(raw.registeredAt) * 1000).toISOString(),
          standard: 'ERC-8004',
        };
      }

      // Dev fallback
      const agent = this._agentStore.get(agentId);
      if (!agent) throw new Error(`Agent ${agentId} not found`);
      return agent;
    } catch (err) {
      console.error(`[ArcNativeIdentity] Failed to get agent identity:`, err.message);
      throw new Error(`ERC-8004 getAgent failed: ${err.message}`);
    }
  }

  /**
   * Create an ERC-8183 Job for task settlement between two agents.
   * @param {object} params
   * @param {string} params.providerAgentId - Provider agent on-chain ID.
   * @param {string} params.clientAgentId - Client agent on-chain ID.
   * @param {string} params.taskDescription - Task description text.
   * @param {string} params.paymentAmount - Payment amount in USDC (human-readable).
   * @param {number} params.deadline - Unix timestamp for job deadline.
   * @returns {Promise<object>} Job creation result.
   */
  async createJob({ providerAgentId, clientAgentId, taskDescription, paymentAmount, deadline }) {
    try {
      const taskMeta = {
        description: taskDescription,
        createdAt: new Date().toISOString(),
      };
      const taskDescriptionURI = this._simulateIpfsUpload(taskMeta);
      const amountWei = ethers.parseUnits(String(paymentAmount), 6);

      if (this.commerceContract && this.signerA) {
        console.log(`[ArcNativeIdentity] Creating ERC-8183 Job: provider=${providerAgentId}, client=${clientAgentId}...`);

        const tx = await this.commerceContract.createJob(
          providerAgentId,
          clientAgentId,
          taskDescriptionURI,
          amountWei,
          deadline
        );
        const receipt = await tx.wait();

        // Parse JobCreated event
        const iface = new ethers.Interface(AGENTIC_COMMERCE_ABI);
        let jobId = 'unknown';
        for (const log of receipt.logs) {
          try {
            const parsed = iface.parseLog({ topics: log.topics, data: log.data });
            if (parsed && parsed.name === 'JobCreated') {
              jobId = parsed.args.jobId.toString();
              break;
            }
          } catch {
            // Not our event, skip
          }
        }

        console.log(`[ArcNativeIdentity] Job created on-chain: jobId=${jobId}, tx=${receipt.hash}`);

        return {
          jobId,
          providerAgentId,
          clientAgentId,
          taskDescriptionURI,
          paymentAmount,
          deadline,
          status: 'created',
          txHash: receipt.hash,
          standard: 'ERC-8183',
          contract: AGENTIC_COMMERCE_ADDRESS,
        };
      }

      // Dev fallback
      const jobId = String(this._nextJobId++);
      const jobData = {
        jobId,
        providerAgentId,
        clientAgentId,
        taskDescriptionURI,
        paymentAmount,
        deadline,
        status: 'created',
        standard: 'ERC-8183',
        contract: AGENTIC_COMMERCE_ADDRESS,
        createdAt: new Date().toISOString(),
      };

      this._jobStore.set(jobId, jobData);
      console.log(`[ArcNativeIdentity] Job created (dev mode): jobId=${jobId}`);
      return jobData;
    } catch (err) {
      console.error(`[ArcNativeIdentity] Job creation failed:`, err.message);
      throw new Error(`ERC-8183 createJob failed: ${err.message}`);
    }
  }

  /**
   * Complete an ERC-8183 Job with a result URI.
   * @param {string} jobId - On-chain job ID.
   * @param {object} result - Task result data to store.
   * @returns {Promise<object>} Completion result.
   */
  async completeJob(jobId, result) {
    try {
      const resultURI = this._simulateIpfsUpload(result);

      if (this.commerceContract && this.signerA) {
        console.log(`[ArcNativeIdentity] Completing job ${jobId}...`);
        const tx = await this.commerceContract.completeJob(jobId, resultURI);
        const receipt = await tx.wait();

        console.log(`[ArcNativeIdentity] Job completed on-chain: tx=${receipt.hash}`);
        return { jobId, status: 'completed', resultURI, txHash: receipt.hash };
      }

      // Dev fallback
      const job = this._jobStore.get(jobId);
      if (!job) throw new Error(`Job ${jobId} not found`);
      job.status = 'completed';
      job.resultURI = resultURI;
      job.completedAt = new Date().toISOString();
      console.log(`[ArcNativeIdentity] Job completed (dev mode): jobId=${jobId}`);
      return { jobId, status: 'completed', resultURI };
    } catch (err) {
      console.error(`[ArcNativeIdentity] Job completion failed:`, err.message);
      throw new Error(`ERC-8183 completeJob failed: ${err.message}`);
    }
  }

  /**
   * Get job details from ERC-8183.
   * @param {string} jobId - On-chain job ID.
   * @returns {Promise<object>} Job details.
   */
  async getJob(jobId) {
    try {
      if (this.commerceContract) {
        const raw = await this.commerceContract.getJob(jobId);
        const statusMap = { 0: 'created', 1: 'in_progress', 2: 'completed', 3: 'cancelled', 4: 'disputed' };
        return {
          jobId,
          providerAgentId: raw.providerAgentId.toString(),
          clientAgentId: raw.clientAgentId.toString(),
          taskDescriptionURI: raw.taskDescriptionURI,
          paymentAmount: ethers.formatUnits(raw.paymentAmount, 6),
          deadline: Number(raw.deadline),
          status: statusMap[Number(raw.status)] || 'unknown',
          resultURI: raw.resultURI,
          standard: 'ERC-8183',
        };
      }

      // Dev fallback
      const job = this._jobStore.get(jobId);
      if (!job) throw new Error(`Job ${jobId} not found`);
      return job;
    } catch (err) {
      console.error(`[ArcNativeIdentity] Failed to get job:`, err.message);
      throw new Error(`ERC-8183 getJob failed: ${err.message}`);
    }
  }
}

module.exports = ArcNativeIdentityService;
