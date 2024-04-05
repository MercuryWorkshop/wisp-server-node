/* eslint-disable @typescript-eslint/no-var-requires */
const http = require("node:http");
const wisp = require("wisp-server-node");
const server = createServer();

server.on("upgrade", (req, socket, head) => {
  if (req.url.endsWith("/wisp/"))
    wisp.routeRequest(req, socket, head);
  else
    socket.end();
});

let port = 8080;

server.on("listening", () => {
  
});

server.listen({
  port,
});