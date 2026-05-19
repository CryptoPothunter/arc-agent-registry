/**
 * IPFS Service - handles metadata upload and retrieval.
 * Uses Pinata or local IPFS node depending on configuration.
 */

const IPFS_GATEWAY = process.env.IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs/';
const PINATA_API_KEY = process.env.PINATA_API_KEY || '';
const PINATA_SECRET = process.env.PINATA_SECRET || '';
const PINATA_ENDPOINT = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';

/**
 * Upload JSON metadata to IPFS via Pinata.
 * @param {object} metadata - The JSON object to pin.
 * @returns {Promise<string>} The IPFS CID (content identifier).
 */
async function uploadToIPFS(metadata) {
  if (!PINATA_API_KEY || !PINATA_SECRET) {
    // Fallback: generate a deterministic mock CID for development
    const hash = Buffer.from(JSON.stringify(metadata)).toString('base64url').slice(0, 46);
    const cid = `Qm${hash}`;
    console.log(`[IPFS] Dev mode - mock CID: ${cid}`);
    return cid;
  }

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
  return result.IpfsHash;
}

/**
 * Fetch JSON metadata from IPFS by CID.
 * @param {string} cid - The IPFS content identifier.
 * @returns {Promise<object>} The parsed JSON metadata.
 */
async function fetchFromIPFS(cid) {
  const url = `${IPFS_GATEWAY}${cid}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`IPFS fetch failed for CID ${cid}: ${response.status}`);
  }

  return response.json();
}

module.exports = { uploadToIPFS, fetchFromIPFS };
