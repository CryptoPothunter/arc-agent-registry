/**
 * Arc Agent Registry - Express Backend Server
 *
 * Provides REST API and WebSocket support for the agent registry,
 * discovery, negotiation, and escrow systems.
 *
 * #27: WebSocket supports both { action: 'subscribe', topics: [...] } (doc spec)
 *      and legacy { type: 'subscribe', topic: '...' } format.
 * #28: Broadcasts all required event types: negotiation_proposed, negotiation_update,
 *      task_completed, escrow_locked, agent_registered, reputation_updated.
 */

require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const { WebSocketServer } = require('ws');

// Route imports
const registryRoutes = require('./routes/registry.routes');
const discoveryRoutes = require('./routes/discovery.routes');
const negotiationRoutes = require('./routes/negotiation.routes');
const escrowRoutes = require('./routes/escrow.routes');
const settlementRoutes = require('./routes/settlement.routes');

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

      // #27: Support both doc-spec format { action, topics[] } and legacy { type, topic }
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
          // Legacy compat: include single topic field
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

  ws.send(JSON.stringify({ type: 'connected', message: 'Arc Agent Registry WS' }));
});

/**
 * Broadcast a message to all subscribers of a topic.
 * #28: All event payloads include { type, event, topic, timestamp } per doc spec.
 * Supported event types: negotiation_proposed, negotiation_update, negotiation_accepted,
 *   negotiation_rejected, task_completed, escrow_locked, escrow_released,
 *   agent_registered, reputation_updated.
 *
 * @param {string} topic - e.g. "agent:123:negotiation", "registry:new_agents"
 * @param {object} data - Payload to send. Must include `type` or `event` field.
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

// Make wsNotify available to route handlers
app.locals.wsNotify = wsNotify;

// --- Routes ---
app.use('/api/registry', registryRoutes);
app.use('/api/discovery', discoveryRoutes);
app.use('/api/negotiation', negotiationRoutes);
app.use('/api/escrow', escrowRoutes);
app.use('/api/settlement', settlementRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'arc-agent-registry',
    uptime: process.uptime(),
    wsClients: wss.clients.size,
  });
});

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
  console.log(`Arc Agent Registry backend running on port ${PORT}`);
  console.log(`WebSocket server available at ws://localhost:${PORT}`);
});

module.exports = { app, server, wss, wsNotify };
