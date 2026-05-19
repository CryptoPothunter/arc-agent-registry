/**
 * SettlementService - handles post-task settlement.
 * Orchestrates fund release, reputation updates, and yield redemption.
 */

const EscrowService = require('./escrow.service');
const RegistryService = require('./registry.service');
const USYCService = require('./usyc.service');

class SettlementService {
  constructor({ escrowService, registryService } = {}) {
    this.escrow = escrowService || new EscrowService();
    this.registry = registryService || new RegistryService();
    this.usyc = new USYCService();
  }

  /**
   * Settle a completed task.
   * - Redeems any USYC yield if funds were deployed.
   * - Releases escrowed funds to the provider.
   * - Updates the provider's reputation score.
   *
   * @param {object} params
   * @param {string} params.taskId - Task identifier.
   * @param {string} params.providerAgentId - Provider agent ID for reputation update.
   * @param {number} [params.qualityScore] - Quality score (0-100) from validation.
   * @param {boolean} [params.yieldDeployed] - Whether funds were deployed to USYC.
   * @returns {Promise<object>} Settlement result.
   */
  async settle({ taskId, providerAgentId, qualityScore = 100, yieldDeployed = false }) {
    const steps = [];

    try {
      // Step 1: Redeem from USYC if funds were deployed
      if (yieldDeployed) {
        try {
          const escrowStatus = await this.escrow.getEscrowStatus(taskId);
          const redeemResult = await this.usyc.redeemFromUSYC({
            shares: escrowStatus.amount,
            signer: this.escrow.signer,
          });
          steps.push({ step: 'usyc_redeem', success: true, ...redeemResult });
        } catch (err) {
          steps.push({ step: 'usyc_redeem', success: false, error: err.message });
          // Continue with settlement even if USYC redemption fails
        }
      }

      // Step 2: Release escrowed funds to provider
      const releaseResult = await this.escrow.releaseFunds(taskId);
      steps.push({ step: 'escrow_release', success: true, ...releaseResult });

      // Step 3: Update provider reputation based on quality score
      try {
        const currentAgent = await this.registry.getAgentInfo(providerAgentId);
        const currentScore = currentAgent.reputationScore || 0;
        // Weighted moving average: 70% existing score + 30% new quality score
        const newScore = Math.round(currentScore * 0.7 + qualityScore * 0.3);

        // If on-chain contract is available, update reputation there
        if (this.registry.contract && this.registry.signer) {
          const tx = await this.registry.contract.updateReputation(providerAgentId, newScore);
          await tx.wait();
        }

        steps.push({
          step: 'reputation_update',
          success: true,
          previousScore: currentScore,
          newScore,
          qualityScore,
        });
      } catch (err) {
        steps.push({ step: 'reputation_update', success: false, error: err.message });
      }

      return {
        taskId,
        providerAgentId,
        settled: true,
        steps,
        settledAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        taskId,
        providerAgentId,
        settled: false,
        error: err.message,
        steps,
      };
    }
  }
}

module.exports = SettlementService;
