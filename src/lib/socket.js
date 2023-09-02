const { Server } = require("socket.io");
let io;

module.exports = {
  init: (httpServer) => {
    io = new Server(httpServer);
    return io;
  },
  getIO: () => {
    if (!io) {
      throw new Error('Socket.io not initialized!');
    }
    return io;
  },
};
