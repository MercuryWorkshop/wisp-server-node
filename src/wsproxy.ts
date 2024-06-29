import WebSocket from "ws";
import { Socket } from "node:net";

export async function handleWsProxy(ws: WebSocket, url: String) {
    const client = new Socket();
    try {
        const destination = url.split("/").pop()!.split(":");
        const host = destination[0];
        const port = parseInt(destination[1]);

        client.connect(port, host);

        client.on("data", (data) => {
            ws.send(data);
        });
        ws.onmessage = (event) => {
            client.write(event.data as string | Uint8Array);
        };
        ws.onclose = () => {
            client.destroy();
        };
        client.on("close", () => {
            ws.close();
        });
    } catch (e) {
        ws.close();
        client.destroy();
    }
}
