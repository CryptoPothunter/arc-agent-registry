import { useEffect, useRef, useState, useCallback } from 'react';

const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:3001';

/**
 * useWebSocket - manages a WebSocket connection with topic subscriptions,
 * auto-reconnect, and message handling.
 *
 * #27: Supports both doc-spec format { action: 'subscribe', topics: [...] }
 *      and legacy { type: 'subscribe', topic: '...' } format.
 *
 * @param {object} options
 * @param {string[]} [options.topics] - Topics to subscribe to on connect.
 * @param {function} [options.onMessage] - Callback for incoming messages.
 * @param {boolean} [options.autoConnect] - Whether to connect immediately (default true).
 * @returns {object} { connected, lastMessage, send, subscribe, unsubscribe, connect, disconnect }
 */
export default function useWebSocket({ topics = [], onMessage, autoConnect = true } = {}) {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const onMessageRef = useRef(onMessage);
  const topicsRef = useRef(topics);

  // Keep refs up to date
  onMessageRef.current = onMessage;
  topicsRef.current = topics;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        setConnected(true);
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = null;
        }
        // #27: Subscribe using batch format { action, topics }
        if (topicsRef.current.length > 0) {
          ws.send(JSON.stringify({
            action: 'subscribe',
            topics: topicsRef.current,
          }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Ignore system messages (subscribed/unsubscribed/connected)
          if (data.type === 'subscribed' || data.type === 'unsubscribed' || data.type === 'connected') {
            return;
          }
          setLastMessage(data);
          onMessageRef.current?.(data);
        } catch {
          setLastMessage(event.data);
          onMessageRef.current?.(event.data);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        // Auto-reconnect after 3 seconds
        reconnectTimer.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };

      wsRef.current = ws;
    } catch (err) {
      console.warn('WebSocket connection failed:', err.message);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
  }, []);

  const send = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(typeof data === 'string' ? data : JSON.stringify(data));
    }
  }, []);

  // #27: subscribe supports single topic or array of topics
  const subscribe = useCallback((topicOrTopics) => {
    const topicArray = Array.isArray(topicOrTopics) ? topicOrTopics : [topicOrTopics];
    send({ action: 'subscribe', topics: topicArray });
  }, [send]);

  const unsubscribe = useCallback((topicOrTopics) => {
    const topicArray = Array.isArray(topicOrTopics) ? topicOrTopics : [topicOrTopics];
    send({ action: 'unsubscribe', topics: topicArray });
  }, [send]);

  useEffect(() => {
    if (autoConnect) connect();
    return disconnect;
  }, [autoConnect, connect, disconnect]);

  return { connected, lastMessage, send, subscribe, unsubscribe, connect, disconnect };
}
