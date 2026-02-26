/**
 * Socket.io server attach and helpers. Call init(server) from index.js after creating http.Server.
 * Emit: match:started, match:goal, match:ended (handled in routes; this just documents the API).
 */
import { Server } from 'socket.io';

let io = null;

export function init(server) {
  io = new Server(server, {
    cors: {
      origin: true,
      credentials: true,
    },
  });
  io.on('connection', (socket) => {
    socket.on('join:landing', () => socket.join('landing'));
    socket.on('join:match', (matchId) => socket.join(`match:${matchId}`));
  });
  return io;
}

export function getIO() {
  return io;
}
