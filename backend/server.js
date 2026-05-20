/**
 * Arc Agent OS - Express Backend Server
 *
 * The Economic Operating System for AI Agents on Arc.
 * Provides REST API, WebSocket support, and autonomous AI agents for the
 * agent registry, marketplace, prediction markets, pipeline orchestration,
 * and investment fund systems.
 */

require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const { WebSocketServer } = require('ws');

// --- Route imports ---
// Core routes
const registryRoutes = require('./routes/registry.routes');
const discoveryRoutes = require('./routes/discovery.routes');
const negotiationRoutes = require('./routes/negotiation.routes');
const escrowRoutes = require('./routes/escrow.routes');
const settlementRoutes = require('./routes/settlement.routes');

// v2.0 routes
const marketDataRoutes = require('./routes/market-data.routes');
const agentIntelligenceRoutes = require('./routes/agent-intelligence.routes');
const pipelineRoutes = require('./routes/pipeline.routes');
const fundRoutes = require('./routes/fund.routes');
const tractionStatsRoutes = require('./routes/traction-stats.routes');
const faucetRoutes = require('./routes/faucet.routes');
const privateIntentRoutes = require('./routes/private-intent.routes');

// --- Autonomous Agent imports ---
let AutonomousPricingAgent, OrchestratorAgent, MarketMakerAgent;
try {
  AutonomousPricingAgent = require('./agents/autonomous-pricing.agent');
  OrchestratorAgent = require('./agents/orchestrator.agent');
  MarketMakerAgent = require('./agents/market-maker.agent');
} catch (e) {
  console.warn('[Warn] Some autonomous agents failed to load:', e.message);
}

const PORT = process.env.PORT || 3001;

// --- Express App Setup ---
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// --- WebSocket Server ---
const wss = new WebSocketServer({ server });

// Topic-based subscription map: topic -> Set<ws>
const subscriptions = new Map();

wss.on('connection', (ws) => {
  ws._topics = new Set();

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      const action = msg.action || msg.type;
      const topicList = msg.topics || (msg.topic ? [msg.topic] : []);

      if (action === 'subscribe' && topicList.length > 0) {
        for (const topic of topicList) {
          ws._topics.add(topic);
          if (!subscriptions.has(topic)) {
            subscriptions.set(topic, new Set());
          }
          subscriptions.get(topic).add(ws);
        }
        ws.send(JSON.stringify({
          type: 'subscribed',
          topics: topicList,
          topic: topicList.length === 1 ? topicList[0] : undefined,
        }));
      }

      if (action === 'unsubscribe' && topicList.length > 0) {
        for (const topic of topicList) {
          ws._topics.delete(topic);
          const subs = subscriptions.get(topic);
          if (subs) {
            subs.delete(ws);
            if (subs.size === 0) subscriptions.delete(topic);
          }
        }
        ws.send(JSON.stringify({
          type: 'unsubscribed',
          topics: topicList,
          topic: topicList.length === 1 ? topicList[0] : undefined,
        }));
      }
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
    }
  });

  ws.on('close', () => {
    for (const topic of ws._topics) {
      const subs = subscriptions.get(topic);
      if (subs) {
        subs.delete(ws);
        if (subs.size === 0) subscriptions.delete(topic);
      }
    }
  });

  ws.send(JSON.stringify({ type: 'connected', message: 'Arc Agent OS WebSocket' }));
});

/**
 * Broadcast a message to all subscribers of a topic.
 */
function wsNotify(topic, data) {
  const subs = subscriptions.get(topic);
  if (!subs || subs.size === 0) return;

  const payload = JSON.stringify({
    topic,
    type: data.type || data.event || 'notification',
    event: data.event || data.type || 'notification',
    ...data,
    timestamp: new Date().toISOString(),
  });
  for (const ws of subs) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}

// Broadcast to all connected clients (no topic filter)
function wsBroadcast(data) {
  const payload = JSON.stringify({
    ...data,
    timestamp: new Date().toISOString(),
  });
  for (const ws of wss.clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}

// Make wsNotify available to route handlers
app.locals.wsNotify = wsNotify;
app.locals.wsBroadcast = wsBroadcast;

// --- Core Routes ---
app.use('/api/registry', registryRoutes);
app.use('/api/discovery', discoveryRoutes);
app.use('/api/negotiation', negotiationRoutes);
app.use('/api/escrow', escrowRoutes);
app.use('/api/settlement', settlementRoutes);

// --- v2.0 Routes ---
app.use('/api/market', marketDataRoutes);
app.use('/api/ai', agentIntelligenceRoutes);
app.use('/api/pipeline', pipelineRoutes);
app.use('/api/fund', fundRoutes);
app.use('/api/stats', tractionStatsRoutes);
app.use('/api/faucet', faucetRoutes);
app.use('/api/intent', privateIntentRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'arc-agent-os',
    version: '2.0.0',
    uptime: process.uptime(),
    wsClients: wss.clients.size,
    autonomousAgents: autonomousAgentStatuses(),
    network: {
      chain: 'Arc Testnet',
      chainId: 5042002,
      rpc: process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network',
    },
  });
});

// --- Autonomous Agent Management ---
const activeAgents = [];

function startAutonomousAgents() {
  console.log('\n--- Starting Autonomous AI Agents ---');

  if (AutonomousPricingAgent) {
    try {
      const pricingAgent = new AutonomousPricingAgent();
      pricingAgent.on('thinking', (thought) => {
        wsBroadcast({ type: 'ai_thought', agent: 'AutonomousPricingAgent', thought });
      });
      pricingAgent.on('decision', (decision) => {
        wsBroadcast({ type: 'ai_decision', agent: 'AutonomousPricingAgent', payload: decision });
      });
      pricingAgent.start();
      activeAgents.push(pricingAgent);
      console.log('  AutonomousPricingAgent started (30s loop)');
    } catch (e) {
      console.warn('  AutonomousPricingAgent failed to start:', e.message);
    }
  }

  if (OrchestratorAgent) {
    try {
      const orchestrator = new OrchestratorAgent();
      orchestrator.start();
      activeAgents.push(orchestrator);
      console.log('  OrchestratorAgent started');
    } catch (e) {
      console.warn('  OrchestratorAgent failed to start:', e.message);
    }
  }

  if (MarketMakerAgent) {
    try {
      const marketMaker = new MarketMakerAgent();
      marketMaker.start();
      activeAgents.push(marketMaker);
      console.log('  MarketMakerAgent started');
    } catch (e) {
      console.warn('  MarketMakerAgent failed to start:', e.message);
    }
  }

  console.log(`--- ${activeAgents.length} Autonomous Agents Running ---\n`);
}

function autonomousAgentStatuses() {
  return activeAgents.map(a => ({
    name: a.name || a.constructor.name,
    status: 'running',
  }));
}

// --- Error Handling Middleware ---
app.use((err, req, res, _next) => {
  console.error(`[Error] ${req.method} ${req.path}:`, err.message);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// --- Start Server ---
server.listen(PORT, () => {
  console.log(`\nArc Agent OS v2.0 running on port ${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
  console.log(`Explorer: https://testnet.arcscan.app`);

  // Start autonomous agents after server is ready
  startAutonomousAgents();
});

module.exports = { app, server, wss, wsNotify, wsBroadcast };
