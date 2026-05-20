/**
 * EscrowService - manages task escrow lifecycle.
 * Handles fund locking, release, disputes, and idle fund deployment to USYC.
 */

const { ethers } = require('ethers');
const { getCache, setCache, CACHE_KEYS, syncOnChainEvent } = require('../config/redis.config');
const TaskEscrowABI = require('../abis/TaskEscrow.json');
const ERC20_ABI = require('../abis/ERC20.json');
const USYCService = require('./usyc.service');

const RPC_URL = process.env.RPC_URL || 'https://rpc.testnet.arc.network';
const ESCROW_ADDRESS = process.env.ESCROW_CONTRACT || '';
const USDC_ADDRESS = process.env.USDC_CONTRACT || '';
const OPERATOR_KEY = process.env.OPERATOR_PRIVATE_KEY || '';

// Escrow status enum matching the contract
const EscrowStatus = {
  0: 'pending',
  1: 'locked',
  2: 'released',
  3: 'disputed',
  4: 'refunded',
};

class EscrowService {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(RPC_URL);
    this.signer = OPERATOR_KEY
      ? new ethers.Wallet(OPERATOR_KEY, this.provider)
      : null;
    this.contract = ESCROW_ADDRESS
      ? new ethers.Contract(ESCROW_ADDRESS, TaskEscrowABI, this.signer || this.provider)
      : null;
    this.usyc = new USYCService();
    // Dev fallback store
    this._store = new Map();
  }

  /**
   * Deposit funds into escrow for a task.
   * @param {object} params
   * @param {string} params.provider - Provider agent wallet address.
   * @param {string} params.amount - USDC amount (human-readable).
   * @param {number} params.deadline - Unix timestamp deadline.
   * @param {string} [params.clientAddress] - Client wallet address.
   * @param {string} [params.agreementHash] - bytes32 hash of the task agreement.
   * @returns {Promise<object>} Escrow deposit result.
   */
  async depositFunds({ provider, amount, deadline, clientAddress, agreementHash }) {
    if (this.contract && this.signer) {
      const amountWei = ethers.parseUnits(amount, 6);
      const taskId = ethers.keccak256(
        ethers.solidityPacked(
          ['address', 'address', 'uint256', 'uint256'],
          [clientAddress || this.signer.address, provider, amountWei, deadline]
        )
      );
      const agreement = agreementHash || ethers.ZeroHash;

      // Approve escrow contract to spend USDC
      if (USDC_ADDRESS) {
        const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, this.signer);
        const approveTx = await usdc.approve(ESCROW_ADDRESS, amountWei);
        await approveTx.wait();
      }

      const tx = await this.contract.deposit(taskId, amountWei, provider, deadline, agreement);
      const receipt = await tx.wait();

      const escrowData = {
        taskId,
        client: clientAddress || this.signer.address,
        provider,
        amount,
        deadline,
        agreementHash: agreement,
        status: 'locked',
        txHash: receipt.hash,
        createdAt: new Date().toISOString(),
      };

      await syncOnChainEvent('FundsLocked', escrowData);
      return escrowData;
    }

    // Dev fallback
    const client = clientAddress || '0x0000000000000000000000000000000000000000';
    const taskId = ethers.keccak256(
      ethers.solidityPacked(
        ['address', 'address', 'string', 'uint256'],
        [client, provider, amount, deadline]
      )
    );
    const escrowData = {
      taskId,
      client,
      provider,
      amount,
      deadline,
      agreementHash: agreementHash || ethers.ZeroHash,
      status: 'locked',
      createdAt: new Date().toISOString(),
    };

    this._store.set(taskId, escrowData);
    await syncOnChainEvent('FundsLocked', escrowData);
    return escrowData;
  }

  /**
   * Release escrowed funds to the provider upon task completion.
   * @param {string} taskId
   * @returns {Promise<object>}
   */
  async releaseFunds(taskId, options = {}) {
    if (this.contract && this.signer) {
      const taskHash = typeof taskId === 'string' && taskId.startsWith('0x')
        ? taskId
        : ethers.keccak256(ethers.toUtf8Bytes(taskId));
      const tx = await this.contract.release(taskHash);
      const receipt = await tx.wait();

      await syncOnChainEvent('FundsReleased', { taskId: taskHash });
      return { taskId: taskHash, status: 'released', txHash: receipt.hash };
    }

    // Dev fallback
    const escrow = this._store.get(taskId);
    if (!escrow) throw new Error(`Escrow for task ${taskId} not found`);
    if (escrow.status !== 'locked') throw new Error(`Cannot release: status is ${escrow.status}`);

    escrow.status = 'released';
    escrow.releasedAt = new Date().toISOString();
    await syncOnChainEvent('FundsReleased', { taskId });
    return { taskId, status: 'released' };
  }

  /**
   * Raise a dispute on an escrowed task.
   * @param {string} taskId
   * @param {string} reason - Reason for dispute (will be hashed to bytes32 evidenceHash).
   * @returns {Promise<object>}
   */
  async raiseDispute(taskId, reason) {
    if (!reason || typeof reason !== 'string') {
      throw new Error('Dispute reason is required');
    }

    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes(reason));

    if (this.contract && this.signer) {
      const taskHash = typeof taskId === 'string' && taskId.startsWith('0x')
        ? taskId
        : ethers.keccak256(ethers.toUtf8Bytes(taskId));
      const tx = await this.contract.dispute(taskHash, evidenceHash);
      const receipt = await tx.wait();

      await syncOnChainEvent('DisputeRaised', { taskId: taskHash, reason, evidenceHash });
      return { taskId: taskHash, status: 'disputed', reason, evidenceHash, txHash: receipt.hash };
    }

    // Dev fallback
    const escrow = this._store.get(taskId);
    if (!escrow) throw new Error(`Escrow for task ${taskId} not found`);
    if (escrow.status !== 'locked') throw new Error(`Cannot dispute: status is ${escrow.status}`);

    escrow.status = 'disputed';
    escrow.disputeReason = reason;
    escrow.evidenceHash = evidenceHash;
    escrow.disputedAt = new Date().toISOString();
    await syncOnChainEvent('DisputeRaised', { taskId, reason, evidenceHash });
    return { taskId, status: 'disputed', reason, evidenceHash };
  }

  /**
   * Get escrow status for a task.
   * @param {string} taskId
   * @returns {Promise<object>}
   */
  async getEscrowStatus(taskId) {
    // Check cache first
    const cached = getCache(`${CACHE_KEYS.ESCROW_PREFIX}${taskId}`);
    if (cached) return cached;

    if (this.contract) {
      const taskHash = typeof taskId === 'string' && taskId.startsWith('0x')
        ? taskId
        : ethers.keccak256(ethers.toUtf8Bytes(taskId));
      const task = await this.contract.tasks(taskHash);
      const status = EscrowStatus[Number(task.status)] || 'unknown';

      return {
        taskId: taskHash,
        client: task.client,
        provider: task.provider,
        amount: ethers.formatUnits(task.amount, 6),
        deadline: Number(task.deadline),
        status,
        agreementHash: task.agreementHash,
      };
    }

    // Dev fallback
    const escrow = this._store.get(taskId);
    if (!escrow) throw new Error(`Escrow for task ${taskId} not found`);
    return escrow;
  }

  /**
   * Deploy idle escrowed funds to USYC for yield generation.
   * Only deploys funds from tasks with long deadlines (> 1 hour).
   * @param {string} taskId
   * @returns {Promise<object>}
   */
  async deployIdleFundsToUSYC(taskId) {
    const escrow = await this.getEscrowStatus(taskId);

    if (escrow.status !== 'locked') {
      throw new Error(`Cannot deploy: escrow status is ${escrow.status}`);
    }

    const now = Math.floor(Date.now() / 1000);
    const timeRemaining = escrow.deadline - now;

    if (timeRemaining < 3600) {
      throw new Error('Deadline too close to deploy to USYC (minimum 1 hour required)');
    }

    const result = await this.usyc.depositToUSYC({
      amount: escrow.amount,
      signer: this.signer,
    });

    return {
      taskId,
      deployed: true,
      ...result,
    };
  }
}

module.exports = EscrowService;
