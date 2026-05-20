/**
 * #38: DiscoveryService unit tests.
 * Tests smart search, filtering (#20), scoring, and caching.
 */

const assert = require('assert');

// Mock RegistryService to provide test agents
class MockRegistryService {
  constructor() {
    this._agents = [
      {
        agentId: '1',
        name: 'DataAnalyzer',
        description: 'Analyzes data sets',
        capabilities: [
          { name: 'data-analysis', pricing: { basePrice: '5.00', currency: 'USDC' } },
        ],
        reputation: { score: 4.8, successRate: 0.99 },
        availability: { status: 'online' },
        metadata: { languages: ['en', 'zh'], tags: ['analytics', 'ml'] },
      },
      {
        agentId: '2',
        name: 'CodeWriter',
        description: 'Writes code in multiple languages',
        capabilities: [
          { name: 'code-generation', pricing: { basePrice: '10.00', currency: 'USDC' } },
        ],
        reputation: { score: 4.2, successRate: 0.95 },
        availability: { status: 'online' },
        metadata: { languages: ['en'], tags: ['coding', 'dev'] },
      },
      {
        agentId: '3',
        name: 'TranslatorBot',
        description: 'Translates text',
        capabilities: [
          { name: 'translation', pricing: { basePrice: '2.00', currency: 'USDC' } },
        ],
        reputation: { score: 3.5, successRate: 0.88 },
        availability: { status: 'offline' },
        metadata: { languages: ['en', 'zh', 'ja'], tags: ['nlp', 'translation'] },
      },
      {
        agentId: '4',
        name: 'CheapAgent',
        description: 'Basic tasks',
        capabilities: ['basic-task'],
        reputation: { score: 4.0, successRate: 0.92 },
        availability: { status: 'online' },
        metadata: { tags: ['general'] },
        basePriceUsdc: '1.00',
      },
    ];
  }

  async getAllActiveAgents() {
    return this._agents;
  }
}

const DiscoveryService = require('../../backend/services/discovery.service');

describe('DiscoveryService', function () {
  let discovery;

  beforeEach(function () {
    discovery = new DiscoveryService(new MockRegistryService());
  });

  describe('Smart Search', function () {
    it('should return all agents with no filters', async function () {
      const results = await discovery.smartSearch({});
      assert.ok(results.length >= 1);
    });

    it('should include matchScore and matchReason in results', async function () {
      const results = await discovery.smartSearch({});
      for (const r of results) {
        assert.ok(r.matchScore !== undefined, 'matchScore should exist');
        assert.ok(typeof r.matchReason === 'string', 'matchReason should be a string');
      }
    });

    it('should respect limit parameter', async function () {
      const results = await discovery.smartSearch({ limit: 2 });
      assert.ok(results.length <= 2);
    });
  });

  describe('#20: Filter - capability', function () {
    it('should filter by capability name', async function () {
      const results = await discovery.smartSearch({ capability: 'data-analysis' });
      assert.ok(results.length >= 1);
      assert.ok(results.every(r => r.agentId === '1'));
    });

    it('should support partial capability matching', async function () {
      const results = await discovery.smartSearch({ capability: 'code' });
      assert.ok(results.some(r => r.agentId === '2'));
    });
  });

  describe('#20: Filter - maxPrice', function () {
    it('should filter by maximum price', async function () {
      const results = await discovery.smartSearch({ maxPrice: 5 });
      // Should include DataAnalyzer (5), TranslatorBot (2), CheapAgent (1)
      // Should exclude CodeWriter (10)
      assert.ok(!results.some(r => r.agentId === '2'));
    });
  });

  describe('#20: Filter - minReputationScore', function () {
    it('should filter by minimum reputation score', async function () {
      const results = await discovery.smartSearch({ minReputationScore: 4.5 });
      assert.ok(results.every(r => {
        const score = r.reputation?.score || 0;
        return score >= 4.5;
      }));
    });

    it('should support minScore alias', async function () {
      const results = await discovery.smartSearch({ minScore: 4.0 });
      assert.ok(results.length >= 1);
    });
  });

  describe('#20: Filter - minSuccessRate', function () {
    it('should filter by minimum success rate', async function () {
      const results = await discovery.smartSearch({ minSuccessRate: 0.95 });
      assert.ok(!results.some(r => r.agentId === '3')); // TranslatorBot has 0.88
    });
  });

  describe('#20: Filter - availableOnly', function () {
    it('should filter to online agents only', async function () {
      const results = await discovery.smartSearch({ availableOnly: true });
      assert.ok(!results.some(r => r.agentId === '3')); // TranslatorBot is offline
    });
  });

  describe('#20: Filter - language', function () {
    it('should filter by supported language', async function () {
      const results = await discovery.smartSearch({ language: 'ja' });
      assert.ok(results.some(r => r.agentId === '3')); // TranslatorBot supports ja
    });
  });

  describe('#20: Filter - tags', function () {
    it('should filter by tags (any match)', async function () {
      const results = await discovery.smartSearch({ tags: ['ml'] });
      assert.ok(results.some(r => r.agentId === '1')); // DataAnalyzer has ml tag
    });

    it('should match any of the provided tags', async function () {
      const results = await discovery.smartSearch({ tags: ['coding', 'nlp'] });
      assert.ok(results.some(r => r.agentId === '2')); // CodeWriter has coding
      assert.ok(results.some(r => r.agentId === '3')); // TranslatorBot has nlp
    });
  });

  describe('#20: Filter - free text search (q)', function () {
    it('should search by name', async function () {
      const results = await discovery.smartSearch({ q: 'DataAnalyzer' });
      assert.ok(results.some(r => r.agentId === '1'));
    });

    it('should search by description', async function () {
      const results = await discovery.smartSearch({ q: 'translates' });
      assert.ok(results.some(r => r.agentId === '3'));
    });

    it('should be case-insensitive', async function () {
      const results = await discovery.smartSearch({ q: 'dataanalyzer' });
      assert.ok(results.some(r => r.agentId === '1'));
    });
  });

  describe('Combined filters', function () {
    it('should apply multiple filters together', async function () {
      const results = await discovery.smartSearch({
        availableOnly: true,
        maxPrice: 6,
        minReputationScore: 4.0,
      });
      // Should only include DataAnalyzer (online, price=5, rep=4.8) and CheapAgent (online, price=1, rep=4.0)
      assert.ok(results.every(r => r.agentId === '1' || r.agentId === '4'));
    });
  });

  describe('Relevance scoring', function () {
    it('should rank exact capability matches higher', async function () {
      const results = await discovery.smartSearch({ capability: 'data-analysis' });
      if (results.length >= 1) {
        assert.ok(results[0].matchScore > 0);
      }
    });

    it('should sort by relevance score then reputation', async function () {
      const results = await discovery.smartSearch({});
      for (let i = 1; i < results.length; i++) {
        if (results[i - 1].matchScore === results[i].matchScore) {
          const prevRep = results[i - 1].reputation?.score || 0;
          const currRep = results[i].reputation?.score || 0;
          assert.ok(prevRep >= currRep, 'Equal matchScore should sort by reputation desc');
        }
      }
    });
  });
});
