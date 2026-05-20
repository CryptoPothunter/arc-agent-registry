/**
 * Arc Agent OS - On-Chain Event Listener
 *
 * Connects to Arc Testnet via WebSocket and listens for contract events
 * from AgentRegistry, TaskEscrow, and ReputationOracle.
 * Automatically reconnects on disconnect.
 *
 * Usage: node listeners/chain-listener.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { ethers } = require('ethers');
const path = require('path');
const fs = require('fs');

// --- Configuration ---

const WSS_URL = process.env.ARC_WSS_URL || 'wss://rpc.testnet.arc.network';
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_DELAY_MS = 60000;

// --- Load contract addresses ---

function loadAddresses() {
  // Try deployed-addresses.json first, fall back to .env
  const deployedPath = path.resolve(__dirname, '../../deployed-addresses.json');
  if (fs.existsSync(deployedPath)) {
    const deployed = JSON.parse(fs.readFileSync(deployedPath, 'utf8'));
    return {
      AgentRegistry: deployed.contracts.AgentRegistry,
      TaskEscrow: deployed.contracts.TaskEscrow,
      ReputationOracle: deployed.contracts.ReputationOracle,
    };
  }

  // Fall back to .env variables
  return {
    AgentRegistry: process.env.REGISTRY_CONTRACT,
    TaskEscrow: process.env.ESCROW_CONTRACT,
    ReputationOracle: process.env.REPUTATION_CONTRACT,
  };
}

// --- Load ABIs ---

const AgentRegistryABI = require('../abis/AgentRegistry.json');
const TaskEscrowABI = require('../abis/TaskEscrow.json');
const ReputationOracleABI = require('../abis/ReputationOracle.json');

// --- Helpers ---

function timestamp() {
  return new Date().toISOString();
}

function log(label, message, data) {
  const prefix = `[${timestamp()}] [${label}]`;
  if (data !== undefined) {
    console.log(prefix, message, JSON.stringify(data, replacer, 2));
  } else {
    console.log(prefix, message);
  }
}

/** JSON replacer that converts BigInt values to strings. */
function replacer(_key, value) {
  return typeof value === 'bigint' ? value.toString() : value;
}

function logError(label, message, err) {
  console.error(`[${timestamp()}] [${label}]`, message, err?.message || err);
}

// --- Event Listener Setup ---

/**
 * Attaches event listeners to a contract for the specified events.
 * Returns a cleanup function that removes all listeners.
 */
function attachListeners(contract, contractName, eventNames) {
  const cleanups = [];

  for (const eventName of eventNames) {
    // Verify the event exists in the ABI
    try {
      contract.interface.getEvent(eventName);
    } catch {
      logError(contractName, `Event "${eventName}" not found in ABI, skipping`);
      continue;
    }

    const handler = (...args) => {
      // ethers v6: last argument is the EventLog object
      const eventLog = args[args.length - 1];
      const parsed = {};

      // Extract named args from the event fragment
      const fragment = eventLog.fragment;
      if (fragment && fragment.inputs) {
        fragment.inputs.forEach((input, i) => {
          parsed[input.name] = args[i];
        });
      }

      log(contractName, `${eventName}`, {
        ...parsed,
        blockNumber: eventLog.log?.blockNumber ?? eventLog.blockNumber,
        transactionHash: eventLog.log?.transactionHash ?? eventLog.transactionHash,
      });
    };

    contract.on(eventName, handler);
    cleanups.push(() => contract.off(eventName, handler));
    log('Setup', `Listening for ${contractName}.${eventName}`);
  }

  return () => cleanups.forEach((fn) => fn());
}

// --- Main Connection Logic ---

let reconnectAttempts = 0;
let cleanupFn = null;
let isShuttingDown = false;

async function startListening() {
  const addresses = loadAddresses();

  // Validate addresses
  for (const [name, addr] of Object.entries(addresses)) {
    if (!addr) {
      logError('Config', `Missing address for ${name}. Set it in deployed-addresses.json or .env`);
      process.exit(1);
    }
  }

  log('Connect', `Connecting to Arc Testnet via ${WSS_URL}`);

  const provider = new ethers.WebSocketProvider(WSS_URL);

  // Wait for the provider to be ready
  const network = await provider.getNetwork();
  reconnectAttempts = 0;
  log('Connect', `Connected to chain ${network.chainId} (${network.name})`);

  // Create contract instances
  const registry = new ethers.Contract(addresses.AgentRegistry, AgentRegistryABI, provider);
  const escrow = new ethers.Contract(addresses.TaskEscrow, TaskEscrowABI, provider);
  const reputation = new ethers.Contract(addresses.ReputationOracle, ReputationOracleABI, provider);

  // Attach event listeners
  // Note: The TaskEscrow ABI defines "FundsLocked" (not "FundsDeposited").
  const cleanups = [
    attachListeners(registry, 'AgentRegistry', ['AgentRegistered']),
    attachListeners(escrow, 'TaskEscrow', [
      'FundsLocked',
      'FundsReleased',
      'FundsRefunded',
      'DisputeRaised',
    ]),
    attachListeners(reputation, 'ReputationOracle', ['RatingSubmitted']),
  ];

  cleanupFn = () => {
    cleanups.forEach((fn) => fn());
  };

  // Handle WebSocket disconnection
  const ws = provider.websocket;
  if (ws) {
    ws.on('close', () => {
      if (isShuttingDown) return;
      logError('WebSocket', 'Connection closed, scheduling reconnect...');
      cleanup();
      scheduleReconnect();
    });

    ws.on('error', (err) => {
      logError('WebSocket', 'Error:', err);
    });
  }

  // Also listen for provider errors
  provider.on('error', (err) => {
    logError('Provider', 'Provider error:', err);
  });

  log('Listener', 'Chain listener is running. Waiting for events...');
}

function cleanup() {
  if (cleanupFn) {
    try {
      cleanupFn();
    } catch {
      // Ignore cleanup errors on a dead provider
    }
    cleanupFn = null;
  }
}

function scheduleReconnect() {
  if (isShuttingDown) return;

  reconnectAttempts++;
  const delay = Math.min(
    RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts - 1),
    MAX_RECONNECT_DELAY_MS
  );

  log('Reconnect', `Attempt ${reconnectAttempts} in ${delay / 1000}s...`);

  setTimeout(async () => {
    try {
      await startListening();
    } catch (err) {
      logError('Reconnect', 'Failed to reconnect:', err);
      scheduleReconnect();
    }
  }, delay);
}

// --- Graceful Shutdown ---

function shutdown(signal) {
  log('Shutdown', `Received ${signal}, shutting down...`);
  isShuttingDown = true;
  cleanup();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// --- Start ---

console.log('');
console.log('===========================================');
console.log('  Arc Agent OS - On-Chain Event Listener');
console.log('===========================================');
console.log('');

startListening().catch((err) => {
  logError('Startup', 'Initial connection failed:', err);
  scheduleReconnect();
});
