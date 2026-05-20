/**
 * IdentityPassportService - Cross-chain identity passport for qualified agents.
 *
 * Mints identity passports for agents that meet reputation thresholds
 * (score >= 4.0, tasks >= 10). Passports serve as portable credentials
 * across chains, containing verified reputation data and capability proofs.
 * All data stored in-memory.
 */

const { ethers } = require('ethers');
const crypto = require('crypto');

class IdentityPassportService {
  constructor() {
    // Passport store: Map<passportTokenId, PassportRecord>
    this._passports = new Map();
    // Agent-to-passport index: Map<agentId, passportTokenId>
    this._agentPassportIndex = new Map();
    // Agent data store for eligibility checks (simulated)
    this._agentData = new Map();
    // Token ID counter
    this._nextTokenId = 1;
  }

  /**
   * Set agent data for eligibility checks.
   * In production, this would query on-chain contracts.
   * @param {string} agentId - Agent identifier.
   * @param {object} data - Agent data with score and tasksCompleted.
   */
  setAgentData(agentId, data) {
    this._agentData.set(agentId, {
      agentId,
      score: data.score || 0,
      tasksCompleted: data.tasksCompleted || 0,
      capabilities: data.capabilities || [],
      wallet: data.wallet || ethers.ZeroAddress,
      name: data.name || `Agent-${agentId}`,
      registeredAt: data.registeredAt || new Date().toISOString(),
    });
    console.log(`[IdentityPassport] Agent data set: agentId=${agentId}, score=${data.score}, tasks=${data.tasksCompleted}`);
  }

  /**
   * Check if an agent is eligible for a passport.
   * Requirements: score >= 4.0 and tasksCompleted >= 10.
   * @param {string} agentId - Agent identifier.
   * @returns {object} Eligibility result.
   */
  checkEligibility(agentId) {
    const agent = this._agentData.get(agentId);
    if (!agent) {
      return {
        eligible: false,
        reason: `Agent ${agentId} not found`,
        requirements: { minScore: 4.0, minTasks: 10 },
      };
    }

    const meetsScore = agent.score >= 4.0;
    const meetsTasks = agent.tasksCompleted >= 10;
    const eligible = meetsScore && meetsTasks;

    const reasons = [];
    if (!meetsScore) reasons.push(`Score ${agent.score} is below minimum 4.0`);
    if (!meetsTasks) reasons.push(`Tasks ${agent.tasksCompleted} is below minimum 10`);

    return {
      eligible,
      agentId,
      currentScore: agent.score,
      currentTasks: agent.tasksCompleted,
      requirements: { minScore: 4.0, minTasks: 10 },
      reason: eligible ? 'Meets all requirements' : reasons.join('; '),
    };
  }

  /**
   * Mint an identity passport for a qualified agent.
   * @param {string} agentId - Agent identifier.
   * @returns {object} Minted passport data.
   */
  mintPassport(agentId) {
    try {
      // Check if agent already has a passport
      if (this._agentPassportIndex.has(agentId)) {
        const existingTokenId = this._agentPassportIndex.get(agentId);
        const existing = this._passports.get(existingTokenId);
        if (existing && existing.status === 'active') {
          throw new Error(`Agent ${agentId} already has an active passport (tokenId: ${existingTokenId})`);
        }
      }

      // Check eligibility
      const eligibility = this.checkEligibility(agentId);
      if (!eligibility.eligible) {
        throw new Error(`Agent ${agentId} is not eligible: ${eligibility.reason}`);
      }

      const agent = this._agentData.get(agentId);
      const passportTokenId = String(this._nextTokenId++);

      // Generate passport hash (simulated on-chain commitment)
      const passportDataHash = ethers.keccak256(
        ethers.toUtf8Bytes(JSON.stringify({
          agentId,
          score: agent.score,
          tasksCompleted: agent.tasksCompleted,
          capabilities: agent.capabilities,
          timestamp: Date.now(),
        }))
      );

      // Generate a unique passport number
      const passportNumber = `ARC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

      const passport = {
        passportTokenId,
        passportNumber,
        agentId,
        owner: agent.wallet,
        name: agent.name,
        score: agent.score,
        tasksCompleted: agent.tasksCompleted,
        capabilities: agent.capabilities,
        passportDataHash,
        status: 'active',
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
        verificationHistory: [],
        crossChainClaims: [],
      };

      this._passports.set(passportTokenId, passport);
      this._agentPassportIndex.set(agentId, passportTokenId);

      console.log(`[IdentityPassport] Passport minted: tokenId=${passportTokenId}, passportNumber=${passportNumber}, agent=${agentId}`);

      return {
        passportTokenId,
        passportNumber,
        agentId,
        owner: agent.wallet,
        name: agent.name,
        score: agent.score,
        tasksCompleted: agent.tasksCompleted,
        capabilities: agent.capabilities,
        passportDataHash,
        status: 'active',
        issuedAt: passport.issuedAt,
        expiresAt: passport.expiresAt,
      };
    } catch (err) {
      console.error(`[IdentityPassport] mintPassport failed:`, err.message);
      throw new Error(`Passport minting failed: ${err.message}`);
    }
  }

  /**
   * Verify a passport by token ID.
   * @param {string} passportTokenId - Passport token ID.
   * @returns {object} Passport verification data.
   */
  verifyPassport(passportTokenId) {
    try {
      const passport = this._passports.get(passportTokenId);
      if (!passport) {
        throw new Error(`Passport ${passportTokenId} not found`);
      }

      const now = new Date();
      const expiresAt = new Date(passport.expiresAt);
      const isExpired = now > expiresAt;
      const isValid = passport.status === 'active' && !isExpired;

      // Record verification
      passport.verificationHistory.push({
        verifiedAt: now.toISOString(),
        result: isValid ? 'valid' : 'invalid',
      });

      console.log(`[IdentityPassport] Passport verified: tokenId=${passportTokenId}, valid=${isValid}`);

      return {
        passportTokenId,
        passportNumber: passport.passportNumber,
        agentId: passport.agentId,
        owner: passport.owner,
        name: passport.name,
        isValid,
        status: isExpired ? 'expired' : passport.status,
        score: passport.score,
        tasksCompleted: passport.tasksCompleted,
        capabilities: passport.capabilities,
        passportDataHash: passport.passportDataHash,
        issuedAt: passport.issuedAt,
        expiresAt: passport.expiresAt,
        verificationCount: passport.verificationHistory.length,
      };
    } catch (err) {
      console.error(`[IdentityPassport] verifyPassport failed:`, err.message);
      throw new Error(`Passport verification failed: ${err.message}`);
    }
  }

  /**
   * Revoke a passport.
   * @param {string} passportTokenId - Passport token ID.
   * @param {string} reason - Reason for revocation.
   * @returns {object} Revocation result.
   */
  revokePassport(passportTokenId, reason) {
    try {
      const passport = this._passports.get(passportTokenId);
      if (!passport) {
        throw new Error(`Passport ${passportTokenId} not found`);
      }

      passport.status = 'revoked';
      passport.revokedAt = new Date().toISOString();
      passport.revocationReason = reason;

      console.log(`[IdentityPassport] Passport revoked: tokenId=${passportTokenId}, reason=${reason}`);

      return {
        passportTokenId,
        agentId: passport.agentId,
        status: 'revoked',
        reason,
        revokedAt: passport.revokedAt,
      };
    } catch (err) {
      console.error(`[IdentityPassport] revokePassport failed:`, err.message);
      throw new Error(`Passport revocation failed: ${err.message}`);
    }
  }

  /**
   * Add a cross-chain claim to a passport.
   * Records that the passport identity was verified on another chain.
   * @param {string} passportTokenId - Passport token ID.
   * @param {string} chainName - Name of the chain (e.g., 'ethereum', 'polygon').
   * @param {string} txHash - Transaction hash on the target chain.
   * @returns {object} Claim result.
   */
  addCrossChainClaim(passportTokenId, chainName, txHash) {
    try {
      const passport = this._passports.get(passportTokenId);
      if (!passport) {
        throw new Error(`Passport ${passportTokenId} not found`);
      }
      if (passport.status !== 'active') {
        throw new Error(`Passport ${passportTokenId} is not active (status: ${passport.status})`);
      }

      const claim = {
        chainName,
        txHash,
        claimedAt: new Date().toISOString(),
      };

      passport.crossChainClaims.push(claim);

      console.log(`[IdentityPassport] Cross-chain claim added: tokenId=${passportTokenId}, chain=${chainName}`);

      return {
        passportTokenId,
        agentId: passport.agentId,
        claim,
        totalClaims: passport.crossChainClaims.length,
      };
    } catch (err) {
      console.error(`[IdentityPassport] addCrossChainClaim failed:`, err.message);
      throw new Error(`Cross-chain claim failed: ${err.message}`);
    }
  }

  /**
   * Get passport by agent ID.
   * @param {string} agentId - Agent identifier.
   * @returns {object|null} Passport data or null.
   */
  getPassportByAgent(agentId) {
    const tokenId = this._agentPassportIndex.get(agentId);
    if (!tokenId) return null;

    const passport = this._passports.get(tokenId);
    if (!passport) return null;

    return {
      passportTokenId: passport.passportTokenId,
      passportNumber: passport.passportNumber,
      agentId: passport.agentId,
      owner: passport.owner,
      name: passport.name,
      status: passport.status,
      score: passport.score,
      tasksCompleted: passport.tasksCompleted,
      capabilities: passport.capabilities,
      issuedAt: passport.issuedAt,
      expiresAt: passport.expiresAt,
      crossChainClaims: passport.crossChainClaims.length,
    };
  }
}

module.exports = IdentityPassportService;
