import wisp from "./ConnectionHandler";
import http from "node:http";
import { Socket } from "node:net";

const httpServer = http.createServer().listen(3000);

httpServer.on("upgrade", (req, socket, head) => {
  const throttleOptions = {
    auth: false,
    throttle: true,
//  throttleLimit: 5 * 1024 * 1024,
//  throttleInterval: 1000
  };

  wisp.routeRequest(req, socket as Socket, head, throttleOptions);
});