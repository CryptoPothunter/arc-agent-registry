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
const USDC_ADDRESS = process.env.USDC_ADDRESS || '0x3600000000000000000000000000000000000000';

// ERC-8004 Contract Addresses (Arc Testnet)
const IDENTITY_REGISTRY_ADDRESS = process.env.ERC8004_IDENTITY_REGISTRY || '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const REPUTATION_REGISTRY_ADDRESS = process.env.ERC8004_REPUTATION_REGISTRY || '0x8004B663056A597Dffe9eCcC1965A193B7388713';
const VALIDATION_REGISTRY_ADDRESS = process.env.ERC8004_VALIDATION_REGISTRY || '0x8004Cb1BF31DAf7788923b405b754f57acEB4272';

// ERC-8183 Contract Address (Arc Testnet)
const AGENTIC_COMMERCE_ADDRESS = process.env.ERC8183_JOB_CONTRACT || '0x0747EEf0706327138c69792bF28Cd525089e4583';

const WALLET_A_KEY = process.env.WALLET_A_PRIVATE_KEY || '';
const WALLET_B_KEY = process.env.WALLET_B_PRIVATE_KEY || '';

// --- ERC-8004 IdentityRegistry ABI ---
const IDENTITY_REGISTRY_ABI = [
  'function register(string metadataURI) external returns (uint256)',
  'function updateMetadata(uint256 agentId, string metadataURI) external',
  'function getAgent(uint256 agentId) external view returns (address agentAddress, string metadataURI, bool isActive, uint256 registeredAt)',
  'function deactivateAgent(uint256 agentId) external',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

// --- ERC-8004 ReputationRegistry ABI ---
const REPUTATION_REGISTRY_ABI = [
  'function giveFeedback(uint256 agentId, int128 score, uint8 feedbackType, string tag, bytes32 feedbackHash) external',
  'event FeedbackGiven(uint256 indexed agentId, address indexed reviewer, int128 score, uint8 feedbackType, string tag)',
];

// --- ERC-8004 ValidationRegistry ABI ---
const VALIDATION_REGISTRY_ABI = [
  'function validationRequest(address validator, uint256 agentId, string requestURI, bytes32 requestHash) external',
  'function validationResponse(bytes32 requestHash, uint8 responseCode, string tag) external',
  'function getValidationStatus(bytes32 requestHash) external view returns (uint8 responseCode, string tag, address validator, bool responded)',
  'event ValidationRequested(uint256 indexed agentId, address indexed owner, address indexed validator, bytes32 requestHash)',
  'event ValidationResponded(bytes32 indexed requestHash, uint8 responseCode, string tag)',
];

// --- ERC-8183 AgenticCommerce ABI (full lifecycle) ---
const AGENTIC_COMMERCE_ABI = [
  'function createJob(string description, address provider, address evaluator, uint256 expiration, address hook) external returns (uint256 jobId)',
  'function setBudget(uint256 jobId, uint256 amount, bytes optParams) external',
  'function fund(uint256 jobId) external',
  'function submitDeliverable(uint256 jobId, bytes32 deliverableHash) external',
  'function completeJob(uint256 jobId) external',
  'function rejectDeliverable(uint256 jobId) external',
  'function cancelJob(uint256 jobId) external',
  'function getJob(uint256 jobId) external view returns (uint256 id, address client, address provider, string description, uint256 budget, uint256 expiration, uint8 status, address hook)',
  'event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider)',
  'event JobFunded(uint256 indexed jobId, uint256 amount)',
  'event DeliverableSubmitted(uint256 indexed jobId, bytes32 deliverableHash)',
  'event JobCompleted(uint256 indexed jobId)',
];

// ERC-20 ABI subset for USDC approval
const ERC20_APPROVE_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
];

// Local IPFS simulation directory
const LOCAL_IPFS_DIR = path.join(__dirname, '..', '.ipfs-local');

class ArcNativeIdentityService {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(RPC_URL);

    // Wallet A is the primary operator (owner role)
    this.signerA = WALLET_A_KEY
      ? new ethers.Wallet(WALLET_A_KEY, this.provider)
      : null;
    // Wallet B for secondary operations (validator / provider role)
    this.signerB = WALLET_B_KEY
      ? new ethers.Wallet(WALLET_B_KEY, this.provider)
      : null;

    // ERC-8004 contracts
    this.identityContract = this.signerA
      ? new ethers.Contract(IDENTITY_REGISTRY_ADDRESS, IDENTITY_REGISTRY_ABI, this.signerA)
      : null;
    this.reputationContract = this.signerB
      ? new ethers.Contract(REPUTATION_REGISTRY_ADDRESS, REPUTATION_REGISTRY_ABI, this.signerB)
      : null;
    this.validationContractOwner = this.signerA
      ? new ethers.Contract(VALIDATION_REGISTRY_ADDRESS, VALIDATION_REGISTRY_ABI, this.signerA)
      : null;
    this.validationContractValidator = this.signerB
      ? new ethers.Contract(VALIDATION_REGISTRY_ADDRESS, VALIDATION_REGISTRY_ABI, this.signerB)
      : null;

    // ERC-8183 contracts (client uses signerA, provider uses signerB)
    this.commerceContractClient = this.signerA
      ? new ethers.Contract(AGENTIC_COMMERCE_ADDRESS, AGENTIC_COMMERCE_ABI, this.signerA)
      : null;
    this.commerceContractProvider = this.signerB
      ? new ethers.Contract(AGENTIC_COMMERCE_ADDRESS, AGENTIC_COMMERCE_ABI, this.signerB)
      : null;

    // USDC contract for approvals
    this.usdcContractA = this.signerA
      ? new ethers.Contract(USDC_ADDRESS, ERC20_APPROVE_ABI, this.signerA)
      : null;

    // Dev fallback stores
    this._agentStore = new Map();
    this._jobStore = new Map();
    this._feedbackStore = [];
    this._validationStore = new Map();
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
        console.log(`[ArcNativeIdentity] Registering agent "${name}" on ERC-8004 IdentityRegistry...`);

        // Step 2: Call register(metadataURI) - mints an NFT representing agent identity
        const tx = await this.identityContract.register(`ipfs://${metadataURI}`);
        const receipt = await tx.wait();

        // Step 3: Retrieve Agent ID from Transfer event (ERC-721 mint)
        const iface = new ethers.Interface(IDENTITY_REGISTRY_ABI);
        let agentId = 'unknown';
        for (const log of receipt.logs) {
          try {
            const parsed = iface.parseLog({ topics: log.topics, data: log.data });
            if (parsed && parsed.name === 'Transfer') {
              // Transfer from address(0) = mint, tokenId is the agent ID
              agentId = parsed.args.tokenId.toString();
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
          metadataURI: `ipfs://${metadataURI}`,
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

  // ========================================================================
  // ERC-8004 Step 4: Record Reputation via ReputationRegistry
  // ========================================================================

  /**
   * Submit reputation feedback for an agent via ERC-8004 ReputationRegistry.
   * Per ERC-8004 spec, agent owners cannot self-record reputation.
   * The validator wallet (signerB) submits the feedback.
   *
   * @param {object} params
   * @param {string} params.agentId - On-chain agent ID.
   * @param {number} params.score - Feedback score (int128, e.g. 100 for good, 20 for bad).
   * @param {number} [params.feedbackType=0] - Feedback type (uint8).
   * @param {string} [params.tag='task_completed'] - Descriptive tag.
   * @returns {Promise<object>} Feedback result.
   */
  async giveFeedback({ agentId, score, feedbackType = 0, tag = 'task_completed' }) {
    try {
      const feedbackHash = ethers.keccak256(ethers.toUtf8Bytes(tag));

      if (this.reputationContract && this.signerB) {
        console.log(`[ArcNativeIdentity] Recording reputation for agent ${agentId} (score=${score})...`);

        const tx = await this.reputationContract.giveFeedback(
          agentId,
          score,
          feedbackType,
          tag,
          feedbackHash
        );
        const receipt = await tx.wait();

        console.log(`[ArcNativeIdentity] Reputation recorded on-chain: tx=${receipt.hash}`);
        return {
          agentId,
          score,
          feedbackType,
          tag,
          feedbackHash,
          txHash: receipt.hash,
          standard: 'ERC-8004',
          contract: REPUTATION_REGISTRY_ADDRESS,
        };
      }

      // Dev fallback
      const feedback = { agentId, score, feedbackType, tag, feedbackHash, recordedAt: new Date().toISOString() };
      this._feedbackStore.push(feedback);
      console.log(`[ArcNativeIdentity] Reputation recorded (dev mode): agent=${agentId}, score=${score}`);
      return feedback;
    } catch (err) {
      console.error(`[ArcNativeIdentity] giveFeedback failed:`, err.message);
      throw new Error(`ERC-8004 giveFeedback failed: ${err.message}`);
    }
  }

  // ========================================================================
  // ERC-8004 Step 6: Request Validation via ValidationRegistry
  // ========================================================================

  /**
   * Initiate a validation request for an agent.
   * The owner wallet (signerA) requests validation from the validator (signerB).
   *
   * @param {object} params
   * @param {string} params.agentId - On-chain agent ID.
   * @param {string} params.requestURI - IPFS URI pointing to validation request details.
   * @param {string} [params.validatorAddress] - Validator address (defaults to signerB).
   * @returns {Promise<object>} Validation request result.
   */
  async requestValidation({ agentId, requestURI, validatorAddress }) {
    try {
      const requestId = `validation-${agentId}-${Date.now()}`;
      const requestHash = ethers.keccak256(ethers.toUtf8Bytes(requestId));
      const validator = validatorAddress || (this.signerB ? await this.signerB.getAddress() : ethers.ZeroAddress);

      if (this.validationContractOwner && this.signerA) {
        const uri = requestURI || `ipfs://${this._simulateIpfsUpload({ agentId, type: 'validation_request', requestId })}`;
        console.log(`[ArcNativeIdentity] Requesting validation for agent ${agentId}...`);

        const tx = await this.validationContractOwner.validationRequest(
          validator,
          agentId,
          uri,
          requestHash
        );
        const receipt = await tx.wait();

        console.log(`[ArcNativeIdentity] Validation requested on-chain: tx=${receipt.hash}`);
        return {
          agentId,
          requestHash,
          validator,
          requestURI: uri,
          txHash: receipt.hash,
          standard: 'ERC-8004',
          contract: VALIDATION_REGISTRY_ADDRESS,
        };
      }

      // Dev fallback
      const validation = { agentId, requestHash, validator, status: 'pending', requestedAt: new Date().toISOString() };
      this._validationStore.set(requestHash, validation);
      console.log(`[ArcNativeIdentity] Validation requested (dev mode): agent=${agentId}`);
      return validation;
    } catch (err) {
      console.error(`[ArcNativeIdentity] requestValidation failed:`, err.message);
      throw new Error(`ERC-8004 validationRequest failed: ${err.message}`);
    }
  }

  // ========================================================================
  // ERC-8004 Step 7: Submit Validation Response
  // ========================================================================

  /**
   * Submit a validation response (validator role).
   * The validator wallet (signerB) responds to the validation request.
   *
   * @param {object} params
   * @param {string} params.requestHash - The original request hash.
   * @param {number} params.responseCode - 100 for passed, 0 for failed.
   * @param {string} [params.tag='kyc_verified'] - Response tag.
   * @returns {Promise<object>} Validation response result.
   */
  async submitValidationResponse({ requestHash, responseCode, tag = 'kyc_verified' }) {
    try {
      if (this.validationContractValidator && this.signerB) {
        console.log(`[ArcNativeIdentity] Submitting validation response (code=${responseCode})...`);

        const tx = await this.validationContractValidator.validationResponse(
          requestHash,
          responseCode,
          tag
        );
        const receipt = await tx.wait();

        console.log(`[ArcNativeIdentity] Validation response submitted: tx=${receipt.hash}`);
        return {
          requestHash,
          responseCode,
          tag,
          txHash: receipt.hash,
          standard: 'ERC-8004',
          contract: VALIDATION_REGISTRY_ADDRESS,
        };
      }

      // Dev fallback
      const validation = this._validationStore.get(requestHash);
      if (validation) {
        validation.status = responseCode === 100 ? 'passed' : 'failed';
        validation.responseCode = responseCode;
        validation.tag = tag;
        validation.respondedAt = new Date().toISOString();
      }
      console.log(`[ArcNativeIdentity] Validation responded (dev mode): code=${responseCode}`);
      return { requestHash, responseCode, tag, status: responseCode === 100 ? 'passed' : 'failed' };
    } catch (err) {
      console.error(`[ArcNativeIdentity] submitValidationResponse failed:`, err.message);
      throw new Error(`ERC-8004 validationResponse failed: ${err.message}`);
    }
  }

  /**
   * Get validation status for a request hash.
   *
   * @param {string} requestHash - The validation request hash.
   * @returns {Promise<object>} Validation status.
   */
  async getValidationStatus(requestHash) {
    try {
      if (this.validationContractOwner) {
        const raw = await this.validationContractOwner.getValidationStatus(requestHash);
        return {
          requestHash,
          responseCode: Number(raw.responseCode),
          tag: raw.tag,
          validator: raw.validator,
          responded: raw.responded,
          standard: 'ERC-8004',
        };
      }

      // Dev fallback
      const validation = this._validationStore.get(requestHash);
      if (!validation) throw new Error(`Validation request ${requestHash} not found`);
      return validation;
    } catch (err) {
      console.error(`[ArcNativeIdentity] getValidationStatus failed:`, err.message);
      throw new Error(`ERC-8004 getValidationStatus failed: ${err.message}`);
    }
  }

  // ========================================================================
  // ERC-8183 Job Lifecycle (full workflow per Arc docs)
  // ========================================================================

  /**
   * Create an ERC-8183 Job.
   * The client (signerA) creates a job with a designated provider and evaluator.
   *
   * @param {object} params
   * @param {string} params.description - Task description.
   * @param {string} params.providerAddress - Provider wallet address.
   * @param {string} [params.evaluatorAddress] - Evaluator address (defaults to client).
   * @param {number} params.deadline - Unix timestamp for job expiration.
   * @param {string} [params.hookAddress] - Optional hook contract address.
   * @returns {Promise<object>} Job creation result.
   */
  async createJob({ description, providerAddress, evaluatorAddress, deadline, hookAddress }) {
    try {
      const evaluator = evaluatorAddress || (this.signerA ? await this.signerA.getAddress() : ethers.ZeroAddress);
      const hook = hookAddress || ethers.ZeroAddress;

      if (this.commerceContractClient && this.signerA) {
        console.log(`[ArcNativeIdentity] Creating ERC-8183 Job: provider=${providerAddress}...`);

        const tx = await this.commerceContractClient.createJob(
          description,
          providerAddress,
          evaluator,
          deadline,
          hook
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
          description,
          providerAddress,
          evaluator,
          deadline,
          status: 'open',
          txHash: receipt.hash,
          standard: 'ERC-8183',
          contract: AGENTIC_COMMERCE_ADDRESS,
        };
      }

      // Dev fallback
      const jobId = String(this._nextJobId++);
      const jobData = {
        jobId,
        description,
        providerAddress,
        evaluator,
        deadline,
        budget: '0',
        status: 'open',
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
   * Set budget for a job (provider role via signerB).
   *
   * @param {string} jobId - On-chain job ID.
   * @param {string} amount - Budget amount in USDC (human-readable).
   * @returns {Promise<object>} Budget result.
   */
  async setBudget(jobId, amount) {
    try {
      const amountWei = ethers.parseUnits(String(amount), 6);

      if (this.commerceContractProvider && this.signerB) {
        console.log(`[ArcNativeIdentity] Setting budget for job ${jobId}: ${amount} USDC...`);

        const tx = await this.commerceContractProvider.setBudget(jobId, amountWei, '0x');
        const receipt = await tx.wait();

        console.log(`[ArcNativeIdentity] Budget set on-chain: tx=${receipt.hash}`);
        return { jobId, budget: amount, txHash: receipt.hash };
      }

      // Dev fallback
      const job = this._jobStore.get(jobId);
      if (!job) throw new Error(`Job ${jobId} not found`);
      job.budget = amount;
      console.log(`[ArcNativeIdentity] Budget set (dev mode): jobId=${jobId}, amount=${amount}`);
      return { jobId, budget: amount };
    } catch (err) {
      console.error(`[ArcNativeIdentity] setBudget failed:`, err.message);
      throw new Error(`ERC-8183 setBudget failed: ${err.message}`);
    }
  }

  /**
   * Fund a job's escrow with USDC (client role via signerA).
   * Requires USDC approval to the ERC-8183 contract first.
   *
   * @param {string} jobId - On-chain job ID.
   * @param {string} amount - Amount to fund in USDC (human-readable).
   * @returns {Promise<object>} Funding result.
   */
  async fundJob(jobId, amount) {
    try {
      const amountWei = ethers.parseUnits(String(amount), 6);

      if (this.commerceContractClient && this.signerA && this.usdcContractA) {
        // Step 1: Approve USDC transfer to AgenticCommerce contract
        console.log(`[ArcNativeIdentity] Approving ${amount} USDC for ERC-8183 escrow...`);
        const approveTx = await this.usdcContractA.approve(AGENTIC_COMMERCE_ADDRESS, amountWei);
        await approveTx.wait();

        // Step 2: Fund the job
        console.log(`[ArcNativeIdentity] Funding job ${jobId} with ${amount} USDC...`);
        const tx = await this.commerceContractClient.fund(jobId);
        const receipt = await tx.wait();

        console.log(`[ArcNativeIdentity] Job funded on-chain: tx=${receipt.hash}`);
        return { jobId, amount, status: 'funded', txHash: receipt.hash };
      }

      // Dev fallback
      const job = this._jobStore.get(jobId);
      if (!job) throw new Error(`Job ${jobId} not found`);
      job.status = 'funded';
      job.fundedAmount = amount;
      console.log(`[ArcNativeIdentity] Job funded (dev mode): jobId=${jobId}`);
      return { jobId, amount, status: 'funded' };
    } catch (err) {
      console.error(`[ArcNativeIdentity] fundJob failed:`, err.message);
      throw new Error(`ERC-8183 fund failed: ${err.message}`);
    }
  }

  /**
   * Submit deliverable for a job (provider role via signerB).
   *
   * @param {string} jobId - On-chain job ID.
   * @param {string} deliverableData - Deliverable content to hash.
   * @returns {Promise<object>} Submission result.
   */
  async submitDeliverable(jobId, deliverableData) {
    try {
      const deliverableHash = ethers.keccak256(ethers.toUtf8Bytes(deliverableData));

      if (this.commerceContractProvider && this.signerB) {
        console.log(`[ArcNativeIdentity] Submitting deliverable for job ${jobId}...`);

        const tx = await this.commerceContractProvider.submitDeliverable(jobId, deliverableHash);
        const receipt = await tx.wait();

        console.log(`[ArcNativeIdentity] Deliverable submitted on-chain: tx=${receipt.hash}`);
        return { jobId, deliverableHash, status: 'submitted', txHash: receipt.hash };
      }

      // Dev fallback
      const job = this._jobStore.get(jobId);
      if (!job) throw new Error(`Job ${jobId} not found`);
      job.status = 'submitted';
      job.deliverableHash = deliverableHash;
      console.log(`[ArcNativeIdentity] Deliverable submitted (dev mode): jobId=${jobId}`);
      return { jobId, deliverableHash, status: 'submitted' };
    } catch (err) {
      console.error(`[ArcNativeIdentity] submitDeliverable failed:`, err.message);
      throw new Error(`ERC-8183 submitDeliverable failed: ${err.message}`);
    }
  }

  /**
   * Complete a job (evaluator/client role via signerA).
   * Approves the deliverable and releases funds to provider.
   *
   * @param {string} jobId - On-chain job ID.
   * @returns {Promise<object>} Completion result.
   */
  async completeJob(jobId) {
    try {
      if (this.commerceContractClient && this.signerA) {
        console.log(`[ArcNativeIdentity] Completing job ${jobId}...`);
        const tx = await this.commerceContractClient.completeJob(jobId);
        const receipt = await tx.wait();

        console.log(`[ArcNativeIdentity] Job completed on-chain: tx=${receipt.hash}`);
        return { jobId, status: 'completed', txHash: receipt.hash };
      }

      // Dev fallback
      const job = this._jobStore.get(jobId);
      if (!job) throw new Error(`Job ${jobId} not found`);
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      console.log(`[ArcNativeIdentity] Job completed (dev mode): jobId=${jobId}`);
      return { jobId, status: 'completed' };
    } catch (err) {
      console.error(`[ArcNativeIdentity] Job completion failed:`, err.message);
      throw new Error(`ERC-8183 completeJob failed: ${err.message}`);
    }
  }

  /**
   * Reject a deliverable (evaluator/client role).
   *
   * @param {string} jobId - On-chain job ID.
   * @returns {Promise<object>} Rejection result.
   */
  async rejectDeliverable(jobId) {
    try {
      if (this.commerceContractClient && this.signerA) {
        console.log(`[ArcNativeIdentity] Rejecting deliverable for job ${jobId}...`);
        const tx = await this.commerceContractClient.rejectDeliverable(jobId);
        const receipt = await tx.wait();

        return { jobId, status: 'rejected', txHash: receipt.hash };
      }

      // Dev fallback
      const job = this._jobStore.get(jobId);
      if (!job) throw new Error(`Job ${jobId} not found`);
      job.status = 'rejected';
      return { jobId, status: 'rejected' };
    } catch (err) {
      console.error(`[ArcNativeIdentity] rejectDeliverable failed:`, err.message);
      throw new Error(`ERC-8183 rejectDeliverable failed: ${err.message}`);
    }
  }

  /**
   * Get job details from ERC-8183.
   * @param {string} jobId - On-chain job ID.
   * @returns {Promise<object>} Job details.
   */
  async getJob(jobId) {
    try {
      if (this.commerceContractClient) {
        const raw = await this.commerceContractClient.getJob(jobId);
        const statusMap = { 0: 'open', 1: 'funded', 2: 'submitted', 3: 'completed', 4: 'rejected', 5: 'expired' };
        return {
          jobId: raw.id.toString(),
          client: raw.client,
          provider: raw.provider,
          description: raw.description,
          budget: ethers.formatUnits(raw.budget, 6),
          expiration: Number(raw.expiration),
          status: statusMap[Number(raw.status)] || 'unknown',
          hook: raw.hook,
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

  /**
   * Execute the full ERC-8183 job lifecycle for demonstration.
   * Steps: createJob -> setBudget -> fund -> submitDeliverable -> completeJob
   *
   * @param {object} params
   * @param {string} params.description - Task description.
   * @param {string} params.budget - Budget in USDC.
   * @param {number} params.deadline - Unix timestamp.
   * @returns {Promise<object>} Full lifecycle result.
   */
  async executeFullJobLifecycle({ description, budget, deadline }) {
    const results = { steps: [] };

    // Step 1: Create job
    const providerAddress = this.signerB ? await this.signerB.getAddress() : '0x0000000000000000000000000000000000000001';
    const job = await this.createJob({ description, providerAddress, deadline });
    results.steps.push({ step: 'createJob', ...job });
    results.jobId = job.jobId;

    // Step 2: Provider sets budget
    const budgetResult = await this.setBudget(job.jobId, budget);
    results.steps.push({ step: 'setBudget', ...budgetResult });

    // Step 3: Client funds escrow
    const fundResult = await this.fundJob(job.jobId, budget);
    results.steps.push({ step: 'fund', ...fundResult });

    // Step 4: Provider submits deliverable
    const deliverable = await this.submitDeliverable(job.jobId, `deliverable-${job.jobId}-${Date.now()}`);
    results.steps.push({ step: 'submitDeliverable', ...deliverable });

    // Step 5: Evaluator completes job
    const completion = await this.completeJob(job.jobId);
    results.steps.push({ step: 'completeJob', ...completion });

    results.status = 'lifecycle_complete';
    return results;
  }

  /**
   * Execute the full ERC-8004 identity workflow for demonstration.
   * Steps: register -> giveFeedback -> requestValidation -> submitValidationResponse -> getValidationStatus
   *
   * @param {object} params
   * @param {string} params.name - Agent name.
   * @param {string} params.description - Agent description.
   * @returns {Promise<object>} Full identity workflow result.
   */
  async executeFullIdentityWorkflow({ name, description }) {
    const results = { steps: [] };

    // Step 1-3: Register agent and get ID
    const agent = await this.registerAgentOnChain({ name, description });
    results.steps.push({ step: 'register', ...agent });
    results.agentId = agent.agentId;

    // Step 4: Record reputation
    const feedback = await this.giveFeedback({ agentId: agent.agentId, score: 100, tag: 'initial_registration' });
    results.steps.push({ step: 'giveFeedback', ...feedback });

    // Step 6: Request validation
    const validation = await this.requestValidation({ agentId: agent.agentId });
    results.steps.push({ step: 'requestValidation', ...validation });

    // Step 7: Submit validation response
    const response = await this.submitValidationResponse({
      requestHash: validation.requestHash,
      responseCode: 100,
      tag: 'kyc_verified',
    });
    results.steps.push({ step: 'validationResponse', ...response });

    // Verify validation status
    const status = await this.getValidationStatus(validation.requestHash);
    results.steps.push({ step: 'getValidationStatus', ...status });

    results.status = 'identity_workflow_complete';
    return results;
  }
}

module.exports = ArcNativeIdentityService;
