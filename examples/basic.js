/* eslint-disable @typescript-eslint/no-var-requires */
const http = require("node:http");
const wisp = require("wisp-server-node");

const httpServer = http.createServer();

httpServer.on("upgrade", (req, socket, head) => {
    wisp.routeRequest(req, socket, head);
});

httpServer.on("listening", () => {
    console.log("HTTP server listening");
});

httpServer.listen({
    port: 8080,
});
