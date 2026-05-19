/**
 * Arc Agent Registry - Express Backend Server
 *
 * Provides REST API and WebSocket support for the agent registry,
 * discovery, negotiation, and escrow systems.
 */

const express = require('express');
const http = require('http');
const cors = require('cors');
const { WebSocketServer } = require('ws');

// Route imports
const registryRoutes = require('./routes/registry.routes');
const discoveryRoutes = require('./routes/discovery.routes');
const negotiationRoutes = require('./routes/negotiation.routes');
const escrowRoutes = require('./routes/escrow.routes');

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

      if (msg.type === 'subscribe' && msg.topic) {
        ws._topics.add(msg.topic);
        if (!subscriptions.has(msg.topic)) {
          subscriptions.set(msg.topic, new Set());
        }
        subscriptions.get(msg.topic).add(ws);
        ws.send(JSON.stringify({ type: 'subscribed', topic: msg.topic }));
      }

      if (msg.type === 'unsubscribe' && msg.topic) {
        ws._topics.delete(msg.topic);
        const subs = subscriptions.get(msg.topic);
        if (subs) subs.delete(ws);
        ws.send(JSON.stringify({ type: 'unsubscribed', topic: msg.topic }));
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
 * @param {string} topic - e.g. "agent:123:negotiation", "registry:new_agents"
 * @param {object} data - Payload to send.
 */
function wsNotify(topic, data) {
  const subs = subscriptions.get(topic);
  if (!subs || subs.size === 0) return;

  const payload = JSON.stringify({ topic, ...data, timestamp: new Date().toISOString() });
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
