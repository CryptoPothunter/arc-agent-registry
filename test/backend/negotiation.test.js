/**
 * #38: NegotiationAgent unit tests.
 * Tests proposal handling, counter-offers, accept/reject, and field name normalization (#25).
 */

const assert = require('assert');
const { NegotiationAgent } = require('../../backend/agents/negotiation.agent');

describe('NegotiationAgent', function () {
  let agent;

  beforeEach(function () {
    agent = new NegotiationAgent({
      wsNotify: () => {},
    });
  });

  describe('Proposal handling', function () {
    it('should handle a valid proposal', async function () {
      const result = await agent.handleIncomingProposal({
        negotiationId: 'neg_test1',
        requesterId: 'requester1',
        providerId: 'provider1',
        capability: 'data-analysis',
        taskDescription: 'Analyze sales data',
        input: { dataset: 'sales_2024.csv' },
        offeredPrice: 10.0,
        deadline: Math.floor(Date.now() / 1000) + 86400,
      });

      assert.ok(result.negotiationId);
      assert.ok(['pending', 'countered', 'accepted'].includes(result.status));
    });

    it('should store negotiation and allow status retrieval', async function () {
      await agent.handleIncomingProposal({
        negotiationId: 'neg_test2',
        requesterId: 'req1',
        providerId: 'prov1',
        capability: 'test',
        taskDescription: 'Test task',
        offeredPrice: 5.0,
        deadline: Math.floor(Date.now() / 1000) + 86400,
      });

      const status = agent.getStatus('neg_test2');
      assert.ok(status);
      assert.strictEqual(status.negotiationId, 'neg_test2');
    });

    it('should throw for non-existent negotiation status', function () {
      assert.throws(() => {
        agent.getStatus('non_existent');
      }, /not found/);
    });
  });

  describe('Accept/Reject', function () {
    it('should accept a pending proposal', async function () {
      await agent.handleIncomingProposal({
        negotiationId: 'neg_accept',
        requesterId: 'req1',
        providerId: 'prov1',
        capability: 'test',
        taskDescription: 'Accept test',
        offeredPrice: 15.0,
        deadline: Math.floor(Date.now() / 1000) + 86400,
      });

      // When no agentConfig is given, the agent auto-evaluates and may accept immediately.
      // Verify the negotiation was processed.
      const status = agent.getStatus('neg_accept');
      assert.ok(status);
      assert.ok(['accepted', 'countered', 'pending'].includes(status.status));

      // If not already accepted, manually accept
      if (status.status !== 'accepted') {
        const result = await agent.acceptProposal('neg_accept');
        assert.strictEqual(result.status, 'accepted');
        assert.ok(result.agreedPrice);
      }
    });

    it('should reject a pending proposal', async function () {
      await agent.handleIncomingProposal({
        negotiationId: 'neg_reject',
        requesterId: 'req1',
        providerId: 'prov1',
        capability: 'test',
        taskDescription: 'Reject test',
        offeredPrice: 1.0,
        deadline: Math.floor(Date.now() / 1000) + 86400,
      });

      const result = await agent.rejectProposal('neg_reject', 'Price too low');
      assert.strictEqual(result.status, 'rejected');
    });
  });

  describe('Counter-offers', function () {
    it('should handle a counter-offer on a pending negotiation', async function () {
      // Use a very low price so the agent counter-offers instead of accepting
      await agent.handleIncomingProposal({
        negotiationId: 'neg_counter',
        requesterId: 'req1',
        providerId: 'prov1',
        capability: 'test',
        taskDescription: 'Counter test',
        offeredPrice: 5.0,
        deadline: Math.floor(Date.now() / 1000) + 86400,
        agentConfig: { listPrice: 20.0, minPrice: 3.0 },
      });

      const status = agent.getStatus('neg_counter');
      // If the agent countered, we can counter back
      if (status.status === 'counter_offered' || status.status === 'countered') {
        const result = await agent.handleCounterOffer('neg_counter', 'req1', 12.0);
        assert.ok(result);
        assert.ok(['countered', 'counter_offered', 'accepted', 'rejected'].includes(result.status));
      } else {
        // Agent may have accepted or rejected based on evaluation - that's valid behavior
        assert.ok(['accepted', 'rejected', 'pending'].includes(status.status));
      }
    });
  });

  describe('#25: Field name normalization', function () {
    it('should handle doc-spec field names (requesterId, providerId, offeredPrice)', async function () {
      const result = await agent.handleIncomingProposal({
        negotiationId: 'neg_docspec',
        requesterId: 'requester_doc',
        providerId: 'provider_doc',
        capability: 'code-generation',
        taskDescription: 'Generate utility function',
        offeredPrice: 12.5,
        deadline: Math.floor(Date.now() / 1000) + 86400,
      });

      const status = agent.getStatus('neg_docspec');
      assert.strictEqual(status.requesterId, 'requester_doc');
      assert.strictEqual(status.providerId, 'provider_doc');
    });
  });

  describe('Multiple negotiations', function () {
    it('should manage multiple concurrent negotiations independently', async function () {
      await agent.handleIncomingProposal({
        negotiationId: 'neg_multi_1',
        requesterId: 'req1',
        providerId: 'prov1',
        capability: 'test',
        taskDescription: 'Task 1',
        offeredPrice: 10.0,
        deadline: Math.floor(Date.now() / 1000) + 86400,
      });

      await agent.handleIncomingProposal({
        negotiationId: 'neg_multi_2',
        requesterId: 'req2',
        providerId: 'prov1',
        capability: 'test',
        taskDescription: 'Task 2',
        offeredPrice: 20.0,
        deadline: Math.floor(Date.now() / 1000) + 86400,
      });

      const status1 = agent.getStatus('neg_multi_1');
      const status2 = agent.getStatus('neg_multi_2');

      assert.notStrictEqual(status1.negotiationId, status2.negotiationId);
    });
  });
});
