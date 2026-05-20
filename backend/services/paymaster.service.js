/**
 * PaymasterService - Circle Paymaster integration for gasless transactions.
 * Sponsors gas fees for agent operations using Circle's Paymaster API,
 * enabling gasless UX via ERC-4337 UserOperations.
 * On Arc Testnet, gas is paid in USDC.
 */

const { ethers } = require('ethers');

// Circle Paymaster configuration for Arc Testnet
const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY || '';
const CIRCLE_PAYMASTER_URL = process.env.CIRCLE_PAYMASTER_URL || 'https://paymaster.arc.network';
const ENTRYPOINT_ADDRESS = process.env.ENTRYPOINT_ADDRESS || '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';
const RPC_URL = process.env.RPC_URL || 'https://rpc.testnet.arc.network';
const PAYMASTER_PRIVATE_KEY = process.env.PAYMASTER_PRIVATE_KEY || '';
const USDC_ADDRESS = process.env.USDC_ADDRESS || '0x3600000000000000000000000000000000000000';

class PaymasterService {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(RPC_URL);
    this.signer = PAYMASTER_PRIVATE_KEY
      ? new ethers.Wallet(PAYMASTER_PRIVATE_KEY, this.provider)
      : null;
    this.circleApiKey = CIRCLE_API_KEY;
    this.paymasterUrl = CIRCLE_PAYMASTER_URL;
    this.entryPointAddress = ENTRYPOINT_ADDRESS;
  }

  /**
   * Sponsor a UserOperation via Circle Paymaster.
   * Sends the unsigned UserOperation to Circle's Paymaster endpoint,
   * which returns paymasterAndData to cover gas costs.
   *
   * @param {object} params
   * @param {string} params.target - The target contract address.
   * @param {string} params.calldata - Encoded function call data.
   * @param {string} params.sender - The sender's smart account address.
   * @param {string} [params.chainId] - Chain ID (defaults to provider chain).
   * @returns {Promise<object>} Sponsored transaction result with paymasterAndData.
   */
  async sponsorTransaction({ target, calldata, sender, chainId }) {
    if (!this.circleApiKey) {
      return this._fallbackSponsor({ target, calldata, sender });
    }

    try {
      // Build the unsigned UserOperation
      const userOp = await this._buildUserOperation({ target, calldata, sender });

      // Request sponsorship from Circle Paymaster
      const sponsorResult = await this._requestCircleSponsorship(userOp, chainId);

      // Attach paymasterAndData to the UserOperation
      userOp.paymasterAndData = sponsorResult.paymasterAndData;

      return {
        sponsored: true,
        userOperation: userOp,
        paymasterAndData: sponsorResult.paymasterAndData,
        sender,
        target,
        entryPoint: this.entryPointAddress,
      };
    } catch (error) {
      console.error('[Paymaster] Circle sponsorship failed:', error.message);
      // Fall back to direct relay if Circle Paymaster is unavailable
      return this._fallbackSponsor({ target, calldata, sender });
    }
  }

  /**
   * Build an unsigned ERC-4337 UserOperation structure.
   *
   * @param {object} params
   * @param {string} params.target - Target contract address.
   * @param {string} params.calldata - Encoded function call data.
   * @param {string} params.sender - Smart account address.
   * @returns {Promise<object>} Unsigned UserOperation.
   * @private
   */
  async _buildUserOperation({ target, calldata, sender }) {
    const nonce = await this._getNonce(sender);
    const { maxFeePerGas, maxPriorityFeePerGas } = await this._getGasPrices();

    return {
      sender,
      nonce: ethers.toBeHex(nonce),
      initCode: '0x',
      callData: calldata,
      callGasLimit: ethers.toBeHex(500000),
      verificationGasLimit: ethers.toBeHex(200000),
      preVerificationGas: ethers.toBeHex(50000),
      maxFeePerGas: ethers.toBeHex(maxFeePerGas),
      maxPriorityFeePerGas: ethers.toBeHex(maxPriorityFeePerGas),
      paymasterAndData: '0x',
      signature: '0x',
    };
  }

  /**
   * Request gas sponsorship from Circle Paymaster API.
   *
   * @param {object} userOp - The unsigned UserOperation.
   * @param {string} [chainId] - Target chain ID.
   * @returns {Promise<object>} Sponsorship response with paymasterAndData.
   * @private
   */
  async _requestCircleSponsorship(userOp, chainId) {
    const resolvedChainId = chainId || (await this.provider.getNetwork()).chainId.toString();

    const response = await fetch(this.paymasterUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.circleApiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'pm_sponsorUserOperation',
        params: [
          userOp,
          this.entryPointAddress,
          { chainId: resolvedChainId },
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Circle Paymaster API error (${response.status}): ${errorBody}`);
    }

    const result = await response.json();

    if (result.error) {
      throw new Error(`Circle Paymaster RPC error: ${result.error.message || JSON.stringify(result.error)}`);
    }

    return result.result;
  }

  /**
   * Get the nonce for a smart account from the EntryPoint contract.
   *
   * @param {string} sender - Smart account address.
   * @returns {Promise<number>} Current nonce.
   * @private
   */
  async _getNonce(sender) {
    try {
      const entryPoint = new ethers.Contract(
        this.entryPointAddress,
        ['function getNonce(address sender, uint192 key) view returns (uint256)'],
        this.provider
      );
      const nonce = await entryPoint.getNonce(sender, 0);
      return Number(nonce);
    } catch {
      return 0;
    }
  }

  /**
   * Get current gas prices from the provider.
   * Arc Testnet requires minimum 20 Gwei base fee (EIP-1559 + EWMA smoothing).
   *
   * @returns {Promise<{ maxFeePerGas: bigint, maxPriorityFeePerGas: bigint }>}
   * @private
   */
  async _getGasPrices() {
    // Arc Testnet minimum base fee: 20 Gwei
    const ARC_MIN_BASE_FEE = ethers.parseUnits('20', 'gwei');
    try {
      const feeData = await this.provider.getFeeData();
      let maxFeePerGas = feeData.maxFeePerGas || ARC_MIN_BASE_FEE;
      // Ensure we meet Arc Testnet minimum (20 Gwei)
      if (maxFeePerGas < ARC_MIN_BASE_FEE) {
        maxFeePerGas = ARC_MIN_BASE_FEE;
      }
      return {
        maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || 0n,
      };
    } catch {
      return {
        maxFeePerGas: ethers.parseUnits('50', 'gwei'),
        maxPriorityFeePerGas: 0n,
      };
    }
  }

  /**
   * Fallback: relay the transaction directly from the paymaster wallet
   * when Circle Paymaster API is unavailable.
   *
   * @param {object} params
   * @param {string} params.target - Target contract address.
   * @param {string} params.calldata - Encoded function call data.
   * @param {string} params.sender - Original sender address.
   * @returns {Promise<object>} Relay result.
   * @private
   */
  async _fallbackSponsor({ target, calldata, sender }) {
    if (!this.signer) {
      console.warn('[Paymaster] No private key configured, returning mock sponsorship');
      return {
        sponsored: false,
        mock: true,
        sender,
        target,
        message: 'Paymaster not configured. Set PAYMASTER_PRIVATE_KEY to enable gas sponsorship.',
      };
    }

    try {
      // On Arc Testnet, gas is paid in USDC
      // The paymaster wallet directly relays the transaction and pays gas in USDC
      console.log(`[Paymaster] Sponsoring transaction via fallback relay (Arc Testnet USDC gas)`);

      const tx = await this.signer.sendTransaction({
        to: target,
        data: calldata,
        gasLimit: 500_000,
      });

      const receipt = await tx.wait();
      // On Arc Testnet, gas is paid in USDC (18 decimals for native balances)
      const gasUsedUSDC = ethers.formatUnits(receipt.gasUsed * receipt.gasPrice, 18);

      return {
        sponsored: true,
        fallback: true,
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
        gasCostUSDC: gasUsedUSDC,
        sender,
        target,
        explorerUrl: `https://testnet.arcscan.app/tx/${receipt.hash}`,
      };
    } catch (error) {
      throw new Error(`Paymaster fallback sponsorship failed: ${error.message}`);
    }
  }

  /**
   * Check if the paymaster service is properly configured.
   *
   * @returns {{ circleConfigured: boolean, fallbackConfigured: boolean }}
   */
  getStatus() {
    return {
      circleConfigured: !!this.circleApiKey,
      fallbackConfigured: !!this.signer,
      entryPoint: this.entryPointAddress,
      paymasterUrl: this.paymasterUrl,
    };
  }
}

module.exports = PaymasterService;
