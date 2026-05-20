/**
 * Signature verification middleware.
 * #16: Validates wallet ownership via EIP-191 or EIP-712 signatures.
 *
 * All routes that accept a `signature` parameter should use this middleware
 * to verify that the caller owns the claimed wallet address.
 */

const { ethers } = require('ethers');

/**
 * Create a middleware that verifies the signature field in the request body.
 *
 * @param {object} options
 * @param {string} options.addressField - The request body field containing the wallet address.
 * @param {string} [options.messageField] - Optional field to use as the signed message.
 *   If not provided, a canonical message is constructed from (address + timestamp).
 * @param {boolean} [options.optional=false] - If true, skip verification when no signature provided.
 * @returns {Function} Express middleware.
 */
function verifySignature({ addressField = 'walletAddress', messageField, optional = false } = {}) {
  return (req, res, next) => {
    const signature = req.body.signature;
    const claimedAddress = req.body[addressField] || req.params.walletAddress;

    // If signature verification is optional and no signature provided, skip
    if (optional && !signature) {
      return next();
    }

    if (!signature) {
      return res.status(401).json({
        error: 'Signature is required for authentication',
        field: 'signature',
      });
    }

    if (!claimedAddress) {
      return res.status(400).json({
        error: `${addressField} is required when signature is provided`,
      });
    }

    try {
      // Determine the signed message
      let message;
      if (messageField && req.body[messageField]) {
        message = req.body[messageField];
      } else {
        // Canonical message: "Arc Agent Registry: <address>:<timestamp>"
        // Accept timestamp within 5-minute window
        const timestamp = req.body.timestamp || Math.floor(Date.now() / 1000);
        message = `Arc Agent Registry: ${claimedAddress.toLowerCase()}:${timestamp}`;

        // Verify timestamp is within acceptable window (5 minutes)
        const now = Math.floor(Date.now() / 1000);
        if (Math.abs(now - timestamp) > 300) {
          return res.status(401).json({
            error: 'Signature timestamp expired (must be within 5 minutes)',
          });
        }
      }

      // Recover the signer address from the signature
      const recoveredAddress = ethers.verifyMessage(message, signature);

      // Compare addresses (case-insensitive)
      if (recoveredAddress.toLowerCase() !== claimedAddress.toLowerCase()) {
        return res.status(401).json({
          error: 'Signature does not match the claimed wallet address',
          claimed: claimedAddress,
          recovered: recoveredAddress,
        });
      }

      // Attach verified address to request for downstream use
      req.verifiedAddress = recoveredAddress;
      next();
    } catch (err) {
      return res.status(401).json({
        error: 'Invalid signature format',
        details: err.message,
      });
    }
  };
}

/**
 * Verify EIP-712 typed data signature.
 * Used for more structured signing scenarios.
 */
function verifyTypedSignature({ addressField = 'walletAddress', domain, types, primaryType } = {}) {
  return (req, res, next) => {
    const signature = req.body.signature;
    const claimedAddress = req.body[addressField];

    if (!signature) {
      return res.status(401).json({ error: 'Signature is required' });
    }

    if (!claimedAddress) {
      return res.status(400).json({ error: `${addressField} is required` });
    }

    try {
      const value = req.body.signedData || req.body;
      const recoveredAddress = ethers.verifyTypedData(
        domain || { name: 'Arc Agent Registry', version: '1', chainId: 5042002 },
        types || {},
        value,
        signature
      );

      if (recoveredAddress.toLowerCase() !== claimedAddress.toLowerCase()) {
        return res.status(401).json({
          error: 'Typed signature does not match the claimed wallet address',
        });
      }

      req.verifiedAddress = recoveredAddress;
      next();
    } catch (err) {
      return res.status(401).json({
        error: 'Invalid typed signature',
        details: err.message,
      });
    }
  };
}

module.exports = { verifySignature, verifyTypedSignature };
