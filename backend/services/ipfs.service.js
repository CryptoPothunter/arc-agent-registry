/**
 * IPFS Service - handles metadata upload and retrieval.
 * Uses Pinata for production, local file storage for development.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IPFS_GATEWAY = process.env.IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs/';
const PINATA_API_KEY = process.env.PINATA_API_KEY || '';
const PINATA_SECRET = process.env.PINATA_SECRET || '';
const PINATA_ENDPOINT = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';

// Local storage directory for dev mode
const LOCAL_IPFS_DIR = path.join(__dirname, '..', '.ipfs-local');

/**
 * Upload JSON metadata to IPFS via Pinata.
 * Falls back to local file storage in development mode.
 * @param {object} metadata - The JSON object to pin.
 * @returns {Promise<string>} The IPFS CID (content identifier).
 */
async function uploadToIPFS(metadata) {
  if (!PINATA_API_KEY || !PINATA_SECRET) {
    return _localUpload(metadata);
  }

  try {
    const response = await fetch(PINATA_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        pinata_api_key: PINATA_API_KEY,
        pinata_secret_api_key: PINATA_SECRET,
      },
      body: JSON.stringify({
        pinataContent: metadata,
        pinataMetadata: { name: metadata.name || 'agent-metadata' },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`IPFS upload failed: ${response.status} - ${errBody}`);
    }

    const result = await response.json();
    console.log(`[IPFS] Pinned to IPFS: ${result.IpfsHash}`);
    return result.IpfsHash;
  } catch (err) {
    console.warn(`[IPFS] Pinata upload failed, falling back to local storage: ${err.message}`);
    return _localUpload(metadata);
  }
}

/**
 * Fetch JSON metadata from IPFS by CID.
 * Falls back to local storage for dev-mode CIDs.
 * @param {string} cid - The IPFS content identifier.
 * @returns {Promise<object>} The parsed JSON metadata.
 */
async function fetchFromIPFS(cid) {
  if (!cid) {
    throw new Error('CID is required');
  }

  // Check local storage first (for dev-mode CIDs)
  const localResult = _localFetch(cid);
  if (localResult) {
    return localResult;
  }

  // Fetch from IPFS gateway
  const url = `${IPFS_GATEWAY}${cid}`;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!response.ok) {
      throw new Error(`IPFS fetch failed for CID ${cid}: ${response.status}`);
    }

    return response.json();
  } catch (err) {
    console.warn(`[IPFS] Failed to fetch CID ${cid} from gateway: ${err.message}`);
    // Return a minimal metadata object instead of throwing
    return {
      _fetchError: true,
      _cid: cid,
      _message: `Metadata not available: ${err.message}`,
    };
  }
}

/**
 * Store metadata locally in dev mode.
 * Generates a deterministic CID based on content hash.
 * @param {object} metadata
 * @returns {string} CID
 * @private
 */
function _localUpload(metadata) {
  // Ensure local IPFS directory exists
  if (!fs.existsSync(LOCAL_IPFS_DIR)) {
    fs.mkdirSync(LOCAL_IPFS_DIR, { recursive: true });
  }

  // Generate a deterministic CID from the metadata content
  const contentHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(metadata))
    .digest('hex');
  const cid = `QmLocal${contentHash.slice(0, 40)}`;

  // Write metadata to local file
  const filePath = path.join(LOCAL_IPFS_DIR, `${cid}.json`);
  fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2));

  console.log(`[IPFS] Dev mode - stored locally: ${cid}`);
  return cid;
}

/**
 * Fetch metadata from local storage.
 * @param {string} cid
 * @returns {object|null} Metadata or null if not found locally.
 * @private
 */
function _localFetch(cid) {
  const filePath = path.join(LOCAL_IPFS_DIR, `${cid}.json`);
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    } catch (err) {
      console.warn(`[IPFS] Failed to read local file for CID ${cid}:`, err.message);
      return null;
    }
  }
  return null;
}

module.exports = { uploadToIPFS, fetchFromIPFS };
