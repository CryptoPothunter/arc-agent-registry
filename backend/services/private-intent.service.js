/**
 * PrivateIntentService - Private intent market for confidential task matching.
 *
 * Allows agents to submit encrypted task intents with capability vectors,
 * then matches them using AI-driven similarity without revealing task content.
 * Uses ethers for hashing/commitments and DeepSeek API for capability extraction.
 */

const { ethers } = require('ethers');
const crypto = require('crypto');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEEPSEEK_MODEL = 'deepseek-chat';

// Predefined capability dimensions for vector representation
const CAPABILITY_DIMENSIONS = [
  'text-generation', 'code-generation', 'image-generation', 'data-analysis',
  'translation', 'summarization', 'search', 'classification',
  'question-answering', 'reasoning', 'math', 'creative-writing',
  'code-review', 'debugging', 'api-integration', 'document-processing',
];

class PrivateIntentService {
  constructor() {
    // Intent store: Map<intentId, IntentRecord>
    this._intents = new Map();
    // Provider capability vectors: Map<providerId, { capabilities, vector }>
    this._providers = new Map();
    this._nextIntentId = 1;
  }

  /**
   * Call DeepSeek API for capability extraction.
   * @param {string} prompt - The prompt to send.
   * @returns {Promise<string>} API response text.
   * @private
   */
  async _callDeepSeek(prompt) {
    if (!DEEPSEEK_API_KEY) {
      console.warn('[PrivateIntent] No DEEPSEEK_API_KEY set, using fallback capability extraction');
      return null;
    }

    try {
      const response = await fetch(`${DEEPSEEK_BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: [
            {
              role: 'system',
              content: `You are a capability extraction engine. Given a task description, output a JSON array of numbers representing how relevant each of these capability dimensions is (0.0 to 1.0): ${CAPABILITY_DIMENSIONS.join(', ')}. Output ONLY the JSON array, no other text.`,
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: 200,
        }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`DeepSeek API error: ${response.status} - ${errBody}`);
      }

      const data = await response.json();
      return data.choices[0].message.content.trim();
    } catch (err) {
      console.error('[PrivateIntent] DeepSeek API call failed:', err.message);
      return null;
    }
  }

  /**
   * Generate a capability vector from a task description using AI.
   * Falls back to keyword-based extraction if API is unavailable.
   * @param {string} taskDescription - The task description text.
   * @returns {Promise<number[]>} Capability vector (length = CAPABILITY_DIMENSIONS.length).
   * @private
   */
  async _generateCapabilityVector(taskDescription) {
    // Try AI-based extraction first
    const aiResponse = await this._callDeepSeek(taskDescription);

    if (aiResponse) {
      try {
        const vector = JSON.parse(aiResponse);
        if (Array.isArray(vector) && vector.length === CAPABILITY_DIMENSIONS.length) {
          return vector.map((v) => Math.min(1.0, Math.max(0.0, parseFloat(v) || 0)));
        }
      } catch {
        console.warn('[PrivateIntent] Failed to parse AI response, using keyword fallback');
      }
    }

    // Fallback: keyword-based extraction
    const lower = taskDescription.toLowerCase();
    return CAPABILITY_DIMENSIONS.map((dim) => {
      const keywords = dim.split('-');
      let score = 0;
      for (const kw of keywords) {
        if (lower.includes(kw)) score += 0.5;
      }
      return Math.min(1.0, score);
    });
  }

  /**
   * Encrypt task description for privacy.
   * @param {string} text - Plain text to encrypt.
   * @returns {object} Encrypted data with key and iv.
   * @private
   */
  _encryptTask(text) {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return {
      encryptedData: encrypted,
      encryptionKey: key.toString('hex'),
      iv: iv.toString('hex'),
    };
  }

  /**
   * Decrypt task description.
   * @param {object} encryptedObj - Object with encryptedData, encryptionKey, iv.
   * @returns {string} Decrypted text.
   * @private
   */
  _decryptTask(encryptedObj) {
    const key = Buffer.from(encryptedObj.encryptionKey, 'hex');
    const iv = Buffer.from(encryptedObj.iv, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedObj.encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Compute cosine similarity between two vectors.
   * @param {number[]} a - First vector.
   * @param {number[]} b - Second vector.
   * @returns {number} Cosine similarity (0 to 1).
   * @private
   */
  _cosineSimilarity(a, b) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (normA * normB);
  }

  /**
   * Submit a private intent to the market.
   * Encrypts the task description and generates a capability vector via AI.
   * @param {string} taskDescription - Plain text task description.
   * @param {string} capability - Primary capability required (e.g., 'code-generation').
   * @param {number} budget - Maximum budget in USDC.
   * @returns {Promise<object>} Intent submission result.
   */
  async submitPrivateIntent(taskDescription, capability, budget) {
    try {
      if (!taskDescription || typeof taskDescription !== 'string') {
        throw new Error('taskDescription is required and must be a string');
      }
      if (!budget || budget <= 0) {
        throw new Error('budget must be a positive number');
      }

      // Encrypt the task description
      const encrypted = this._encryptTask(taskDescription);

      // Generate capability vector via AI
      const capabilityVector = await this._generateCapabilityVector(taskDescription);

      // Create commitment hash (ethers keccak256 of description + budget)
      const commitment = ethers.keccak256(
        ethers.toUtf8Bytes(`${taskDescription}:${budget}:${Date.now()}`)
      );

      const intentId = `intent-${this._nextIntentId++}`;
      const intentRecord = {
        intentId,
        commitment,
        primaryCapability: capability,
        capabilityVector,
        budget,
        encrypted,
        status: 'open',
        matches: [],
        createdAt: new Date().toISOString(),
      };

      this._intents.set(intentId, intentRecord);

      console.log(`[PrivateIntent] Intent submitted: id=${intentId}, commitment=${commitment.slice(0, 18)}...`);

      // Return public-facing data (without encryption key)
      return {
        intentId,
        commitment,
        primaryCapability: capability,
        capabilityVector,
        budget,
        status: 'open',
        createdAt: intentRecord.createdAt,
      };
    } catch (err) {
      console.error('[PrivateIntent] submitPrivateIntent failed:', err.message);
      throw new Error(`Private intent submission failed: ${err.message}`);
    }
  }

  /**
   * Register a provider's capabilities for matching.
   * @param {string} providerId - Provider identifier.
   * @param {string[]} capabilities - List of capability names.
   * @param {string} [description] - Optional provider description for AI vectorization.
   * @returns {Promise<object>} Registration result.
   */
  async registerProvider(providerId, capabilities, description) {
    try {
      let vector;
      if (description) {
        vector = await this._generateCapabilityVector(description);
      } else {
        // Build vector from explicit capabilities
        vector = CAPABILITY_DIMENSIONS.map((dim) =>
          capabilities.some((c) => c.toLowerCase().includes(dim.split('-')[0])) ? 1.0 : 0.0
        );
      }

      this._providers.set(providerId, {
        providerId,
        capabilities,
        vector,
        registeredAt: new Date().toISOString(),
      });

      console.log(`[PrivateIntent] Provider registered: id=${providerId}, capabilities=${capabilities.join(', ')}`);

      return {
        providerId,
        capabilities,
        vectorDimensions: vector.length,
        registeredAt: new Date().toISOString(),
      };
    } catch (err) {
      console.error('[PrivateIntent] registerProvider failed:', err.message);
      throw new Error(`Provider registration failed: ${err.message}`);
    }
  }

  /**
   * Match a private intent with registered providers using AI-driven similarity.
   * Matching is done on capability vectors without revealing task content.
   * @param {string} intentId - The intent to match.
   * @returns {Promise<object>} Match results.
   */
  async matchPrivateIntent(intentId) {
    try {
      const intent = this._intents.get(intentId);
      if (!intent) {
        throw new Error(`Intent ${intentId} not found`);
      }

      if (intent.status !== 'open') {
        throw new Error(`Intent ${intentId} is not open (status: ${intent.status})`);
      }

      const matches = [];

      for (const [providerId, provider] of this._providers) {
        const similarity = this._cosineSimilarity(intent.capabilityVector, provider.vector);

        if (similarity > 0.3) {
          matches.push({
            providerId,
            similarity: parseFloat(similarity.toFixed(4)),
            capabilities: provider.capabilities,
          });
        }
      }

      // Sort by similarity descending
      matches.sort((a, b) => b.similarity - a.similarity);

      // Store matches on the intent
      intent.matches = matches;
      intent.matchedAt = new Date().toISOString();

      console.log(`[PrivateIntent] Intent ${intentId} matched with ${matches.length} providers`);

      return {
        intentId,
        commitment: intent.commitment,
        primaryCapability: intent.primaryCapability,
        budget: intent.budget,
        matches: matches.slice(0, 10), // Top 10 matches
        totalMatches: matches.length,
        matchedAt: intent.matchedAt,
      };
    } catch (err) {
      console.error('[PrivateIntent] matchPrivateIntent failed:', err.message);
      throw new Error(`Intent matching failed: ${err.message}`);
    }
  }

  /**
   * Reveal a private intent's task description (only with encryption key).
   * Used after matching to share details with selected provider.
   * @param {string} intentId - The intent ID.
   * @returns {string} Decrypted task description.
   */
  revealIntent(intentId) {
    const intent = this._intents.get(intentId);
    if (!intent) {
      throw new Error(`Intent ${intentId} not found`);
    }

    return this._decryptTask(intent.encrypted);
  }

  /**
   * Get intent status (public-facing, no task content).
   * @param {string} intentId - The intent ID.
   * @returns {object} Intent status.
   */
  getIntentStatus(intentId) {
    const intent = this._intents.get(intentId);
    if (!intent) {
      throw new Error(`Intent ${intentId} not found`);
    }

    return {
      intentId: intent.intentId,
      commitment: intent.commitment,
      primaryCapability: intent.primaryCapability,
      budget: intent.budget,
      status: intent.status,
      matchCount: intent.matches.length,
      createdAt: intent.createdAt,
      matchedAt: intent.matchedAt || null,
    };
  }
}

module.exports = PrivateIntentService;
