import wisp from "./ConnectionHandler";
import http from "node:http";
import { Socket } from "node:net";

console.clear();
console.log("THIS SOFTWARE MUST NOT BE SOLD NEITHER ALONE NOR AS A PART OF A SOFTWARE PACKAGE");
console.log("IF YOU PAID FOR THIS SOFTWARE, YOU HAVE BEEN SCAMMED!");
console.log("IMMEDIATELY DEMAND A REFUND");

const httpServer = http.createServer().listen(3000);

httpServer.on("upgrade", (req, socket, head) => {
    wisp.routeRequest(req, socket as Socket, head);
});
