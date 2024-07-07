import { WebSocketServer } from "ws";
import wisp from "./ConnectionHandler";
import http from "node:http";
import { Socket } from "node:net";

const httpServer = http.createServer().listen(process.env.PORT || 3000);

httpServer.on("upgrade", (req, socket, head) => {
    wisp.routeRequest(req, socket as Socket, head);
});
