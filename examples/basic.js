/* eslint-disable @typescript-eslint/no-var-requires */
const http = require("node:http");
const wisp = require("wisp-server-node");

const httpServer = http.createServer();

httpServer.on("upgrade", (req, socket, head) => {
  wisp.routeRequest(req, socket, head, {
    logging: true,
    auth: false,
    throttle: true,
    throttleLimit: 5 * 1024 * 1024, // throttle limit: 5 MB
    throttleInterval: 5000, // throttle check interval: 5 seconds
  });
});

httpServer.on("listening", () => {
  console.log("HTTP server listening");
});

httpServer.listen({
  port: 8080,
});