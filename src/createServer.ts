import { WebSocketServer } from "ws";
import wisp from "./ConnectionHandler.ts";
import http from "node:http";
import { LOG_LEVEL } from "./Types.ts";
import net, { Socket } from "node:net";

const httpServer = http.createServer().listen(process.env.PORT || 3000);

httpServer.on("upgrade", (req, socket, head) => {
    wisp.routeRequest(req, socket as Socket, head, {
        logLevel: LOG_LEVEL.DEBUG,
        pingInterval: 30
    });
});
