/**
 * WebSocketServer.js
 *
 * Phase E.3: WebSocket Server for Notification Delivery
 *
 * Manages authenticated WebSocket connections and provides
 * real-time notification delivery to connected clients.
 *
 * Invariants:
 * - E.3.2: At-least-once delivery, exactly-once UX (client dedupes by ID)
 * - E.3.3: Offline safety (WebSocket is optimization, not requirement)
 * - E.3.4: All delivery attempts are observable
 */

import { WebSocketServer as WSServer } from "ws";
import { auth } from "../../auth.js";
import { addBreadcrumb, captureError } from "../../sentry.js";

/**
 * Map of recipientId -> Set of WebSocket connections
 * @type {Map<string, Set<WebSocket>>}
 */
const connectionsByUser = new Map();

/**
 * Map of WebSocket -> recipientId (reverse lookup)
 * @type {WeakMap<WebSocket, string>}
 */
const userByConnection = new WeakMap();

/**
 * Reference to the WebSocket server instance
 * @type {WSServer|null}
 */
let wss = null;

/**
 * Heartbeat interval handle
 * @type {NodeJS.Timer|null}
 */
let heartbeatInterval = null;

/**
 * Initializes the WebSocket server and attaches it to the HTTP server.
 *
 * @param {import('http').Server} server - HTTP server instance
 * @returns {WSServer}
 */
export function initWebSocketServer(server) {
  wss = new WSServer({
    server,
    path: "/ws/notifications",
    // Verify upgrade requests via Better Auth
    verifyClient: async (info, callback) => {
      try {
        // Extract session from cookies or Authorization header
        const session = await auth.api.getSession({
          headers: {
            cookie: info.req.headers.cookie || "",
            authorization: info.req.headers.authorization || "",
          },
        });

        if (session && session.user) {
          // Attach user to request for later access
          info.req.user = session.user;
          callback(true);
        } else {
          addBreadcrumb("websocket", "Connection rejected: no session", {
            origin: info.origin,
          });
          callback(false, 401, "Unauthorized");
        }
      } catch (error) {
        console.error("[WS] Auth verification failed:", error);
        captureError(error, {
          component: "WebSocketServer",
          operation: "verifyClient",
        });
        callback(false, 500, "Internal Server Error");
      }
    },
  });

  wss.on("connection", handleConnection);

  wss.on("error", (error) => {
    console.error("[WS] Server error:", error);
    captureError(error, {
      component: "WebSocketServer",
      operation: "server-error",
    });
  });

  // Start heartbeat to detect dead connections
  heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        const userId = userByConnection.get(ws);
        addBreadcrumb("websocket", "Terminating dead connection", { userId });
        return ws.terminate();
      }

      ws.isAlive = false;
      ws.ping();
    });
  }, 30000); // 30 second heartbeat

  console.log("[WS] WebSocket server initialized at /ws/notifications");
  return wss;
}

/**
 * Handles a new WebSocket connection.
 *
 * @param {WebSocket} ws
 * @param {import('http').IncomingMessage} request
 */
function handleConnection(ws, request) {
  const user = request.user;
  const userId = user.id;

  // Setup connection tracking
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  // Register connection
  if (!connectionsByUser.has(userId)) {
    connectionsByUser.set(userId, new Set());
  }
  connectionsByUser.get(userId).add(ws);
  userByConnection.set(ws, userId);

  addBreadcrumb("websocket", "Client connected", {
    userId,
    totalConnections: connectionsByUser.get(userId).size,
  });

  // Send welcome message with connection info
  sendToSocket(ws, {
    type: "connected",
    userId,
    message: "Notification channel established",
  });

  // Handle incoming messages (for future use)
  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());
      handleClientMessage(ws, userId, message);
    } catch (error) {
      console.error("[WS] Invalid message from client:", error);
    }
  });

  // Handle disconnection
  ws.on("close", (code, reason) => {
    const connections = connectionsByUser.get(userId);
    if (connections) {
      connections.delete(ws);
      if (connections.size === 0) {
        connectionsByUser.delete(userId);
      }
    }

    addBreadcrumb("websocket", "Client disconnected", {
      userId,
      code,
      reason: reason?.toString(),
      remainingConnections: connections?.size || 0,
    });
  });

  // Handle errors
  ws.on("error", (error) => {
    console.error("[WS] Client error:", error);
    captureError(error, {
      component: "WebSocketServer",
      operation: "client-error",
      userId,
    });
  });
}

/**
 * Handles messages from connected clients.
 *
 * @param {WebSocket} ws
 * @param {string} userId
 * @param {Object} message
 */
function handleClientMessage(ws, userId, message) {
  // Currently only supporting ping/pong for connection keepalive
  if (message.type === "ping") {
    sendToSocket(ws, { type: "pong" });
  }

  // Future: handle acknowledgements, subscribe/unsubscribe, etc.
}

/**
 * Sends a message to a specific WebSocket.
 *
 * @param {WebSocket} ws
 * @param {Object} message
 * @returns {boolean}
 */
function sendToSocket(ws, message) {
  if (ws.readyState === 1) { // WebSocket.OPEN
    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error("[WS] Send error:", error);
      return false;
    }
  }
  return false;
}

/**
 * Sends a notification to all connected sockets for a user.
 *
 * @param {string} recipientId - User ID
 * @param {Object} notification - Notification payload
 * @returns {{delivered: boolean, connectionCount: number}}
 */
export function deliverToUser(recipientId, notification) {
  const connections = connectionsByUser.get(recipientId);

  if (!connections || connections.size === 0) {
    addBreadcrumb("websocket", "No active connections for user", {
      recipientId,
    });
    return { delivered: false, connectionCount: 0 };
  }

  let successCount = 0;
  const message = {
    type: "notification",
    ...notification,
  };

  for (const ws of connections) {
    if (sendToSocket(ws, message)) {
      successCount++;
    }
  }

  addBreadcrumb("websocket", "Notification delivered", {
    recipientId,
    notificationId: notification.notificationId,
    successCount,
    totalConnections: connections.size,
  });

  return {
    delivered: successCount > 0,
    connectionCount: connections.size,
  };
}

/**
 * Checks if a user has any active WebSocket connections.
 *
 * @param {string} userId
 * @returns {boolean}
 */
export function isUserConnected(userId) {
  const connections = connectionsByUser.get(userId);
  return connections && connections.size > 0;
}

/**
 * Gets the number of active connections for a user.
 *
 * @param {string} userId
 * @returns {number}
 */
export function getConnectionCount(userId) {
  const connections = connectionsByUser.get(userId);
  return connections ? connections.size : 0;
}

/**
 * Gets total number of active connections.
 *
 * @returns {number}
 */
export function getTotalConnections() {
  let total = 0;
  for (const connections of connectionsByUser.values()) {
    total += connections.size;
  }
  return total;
}

/**
 * Closes the WebSocket server gracefully.
 *
 * @returns {Promise<void>}
 */
export async function closeWebSocketServer() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  if (wss) {
    // Close all connections
    for (const [userId, connections] of connectionsByUser.entries()) {
      for (const ws of connections) {
        ws.close(1001, "Server shutting down");
      }
    }
    connectionsByUser.clear();

    return new Promise((resolve) => {
      wss.close(() => {
        console.log("[WS] WebSocket server closed");
        wss = null;
        resolve();
      });
    });
  }
}

/**
 * Gets the WebSocket server instance.
 *
 * @returns {WSServer|null}
 */
export function getWebSocketServer() {
  return wss;
}
