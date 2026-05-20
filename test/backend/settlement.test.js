/**
 * #38: SettlementService unit tests.
 * Tests decay-factor reputation algorithm (#21), yield tracking (#24),
 * and settlement flow orchestration.
 */

const assert = require('assert');

// Mock dependencies to avoid requiring actual blockchain/IPFS
class MockEscrowService {
  constructor() {
    this._escrows = new Map();
    this.signer = { getAddress: async () => '0xMockSigner' };
  }
  async getEscrowStatus(taskId) {
    return this._escrows.get(taskId) || { taskId, amount: '10.00', status: 'locked', provider: '0xProvider' };
  }
  async releaseFunds(taskId) {
    const e = this._escrows.get(taskId) || { taskId, amount: '10.00', status: 'locked' };
    e.status = 'released';
    this._escrows.set(taskId, e);
    return { taskId, status: 'released', txHash: '0xMockReleaseTx' };
  }
}

class MockReputationService {
  constructor() { this._scores = new Map(); }
  async getAverageScore(agentId) {
    return { averageScore: this._scores.get(agentId) || 80 };
  }
  async submitRating(agentId, rating) {
    return { agentId, rating, txHash: '0xMockRatingTx' };
  }
}

class MockRegistryService {
  async getAgentInfo(agentId) {
    return { agentId, walletAddress: '0xProviderWallet', metadata: { name: 'TestAgent' } };
  }
}

class MockGatewayService {
  async getUnifiedBalance(address) {
    return { balances: { 'arc-testnet': '10.00' } };
  }
}

// Load SettlementService with mocks
const SettlementService = require('../../backend/services/settlement.service');

describe('SettlementService', function () {
  let settlement, mockEscrow, mockReputation;

  beforeEach(function () {
    mockEscrow = new MockEscrowService();
    mockReputation = new MockReputationService();
    settlement = new SettlementService({
      escrowService: mockEscrow,
      registryService: new MockRegistryService(),
      gatewayService: new MockGatewayService(),
      reputationService: mockReputation,
    });
  });

  describe('#21: Decay-factor reputation algorithm', function () {
    it('should use DECAY_FACTOR=0.95 instead of fixed 70/30', function () {
      assert.strictEqual(settlement.decayFactor, 0.95);
    });

    it('should calculate new score using decay formula', async function () {
      // With currentScore=80, qualityScore=100, DECAY_FACTOR=0.95:
      // newScore = 0.95 * 80 + 0.05 * 100 = 76 + 5 = 81
      mockReputation._scores.set('agent1', 80);
      const result = await settlement.settle({
        taskId: 'task1',
        providerAgentId: 'agent1',
        qualityScore: 100,
      });

      assert.strictEqual(result.settled, true);
      const repStep = result.steps.find(s => s.step === 'reputation_update');
      assert.ok(repStep, 'reputation_update step should exist');
      assert.strictEqual(repStep.success, true);
      assert.strictEqual(repStep.previousScore, 80);
      assert.strictEqual(repStep.newScore, 81); // 0.95*80 + 0.05*100 = 81
    });

    it('should barely change score for same quality as current (stable reputation)', async function () {
      mockReputation._scores.set('agent2', 80);
      const result = await settlement.settle({
        taskId: 'task2',
        providerAgentId: 'agent2',
        qualityScore: 80,
      });

      const repStep = result.steps.find(s => s.step === 'reputation_update');
      assert.strictEqual(repStep.newScore, 80); // 0.95*80 + 0.05*80 = 80
    });

    it('should slowly decrease score for poor quality', async function () {
      mockReputation._scores.set('agent3', 80);
      const result = await settlement.settle({
        taskId: 'task3',
        providerAgentId: 'agent3',
        qualityScore: 0,
      });

      const repStep = result.steps.find(s => s.step === 'reputation_update');
      assert.strictEqual(repStep.newScore, 76); // 0.95*80 + 0.05*0 = 76
    });
  });

  describe('Settlement flow', function () {
    it('should complete basic settlement with all steps', async function () {
      const result = await settlement.settle({
        taskId: 'task-basic',
        providerAgentId: 'agent-basic',
        qualityScore: 90,
      });

      assert.strictEqual(result.settled, true);
      assert.strictEqual(result.taskId, 'task-basic');
      assert.ok(result.settledAt);

      const stepNames = result.steps.map(s => s.step);
      assert.ok(stepNames.includes('escrow_release'));
      assert.ok(stepNames.includes('reputation_update'));
      assert.ok(stepNames.includes('cross_chain_check'));
    });

    it('should handle USYC redemption step when yieldDeployed=true', async function () {
      const result = await settlement.settle({
        taskId: 'task-yield',
        providerAgentId: 'agent-yield',
        qualityScore: 85,
        yieldDeployed: true,
      });

      // USYC step will fail (mock doesn't implement full USYC) but settlement continues
      const usycStep = result.steps.find(s => s.step === 'usyc_redeem');
      assert.ok(usycStep, 'usyc_redeem step should exist');
    });

    it('should skip USYC step when yieldDeployed=false', async function () {
      const result = await settlement.settle({
        taskId: 'task-noyield',
        providerAgentId: 'agent-noyield',
        qualityScore: 85,
        yieldDeployed: false,
      });

      const usycStep = result.steps.find(s => s.step === 'usyc_redeem');
      assert.ok(!usycStep, 'usyc_redeem step should not exist');
    });
  });
});
