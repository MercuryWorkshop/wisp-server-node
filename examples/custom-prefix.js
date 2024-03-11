/* eslint-disable @typescript-eslint/no-var-requires */
const http = require("node:http");
const wisp = require("wisp-server-node");

const httpServer = http.createServer();

httpServer.on("upgrade", (req, socket, head) => {
    // please include thr trailing slash
    if (req.url.endsWith("/wisp/")) wisp.routeRequest(req, socket, head);
    else socket.end();
});

httpServer.on("listening", () => {
    console.log("HTTP server listening");
});

httpServer.listen({
    port: 8080,
});
