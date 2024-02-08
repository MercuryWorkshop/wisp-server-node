import WebSocket from "ws";

export function createWispServer() {
  const wss = new WebSocket.Server({port: 8080 });

  console.log("Wisp server node where the hell do I start");

  wss.on("connection", (ws: WebSocket) => {
    console.log("Client connected");
  
    ws.on("message", (message: string) => {
      console.log("Received message: " + message);
      ws.send("Got " + message);
    });
  
    ws.on("close", () => {
      console.log("Client disconnected");
    });
  });
}
