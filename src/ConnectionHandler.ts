import { STREAM_TYPE, CONNECT_TYPE, WispFrame } from "./Types";
import WebSocket, { WebSocketServer } from "ws";
import net, { Socket } from "node:net";
import dgram from "node:dgram";
import { IncomingMessage } from "node:http";
import FrameParsers, { continuePacketMaker, dataPacketMaker } from "./Packets";
import { handleWsProxy } from "./wsproxy";

const wss = new WebSocket.Server({ noServer: true }); // This is for handling upgrades incase the server doesn't handle them before passing it to us

// Accepts either routeRequest(ws) or routeRequest(request, socket, head) like bare
export async function routeRequest(wsOrIncomingMessage: WebSocket | IncomingMessage, socket?: Socket, head?: Buffer) {
    if (!(wsOrIncomingMessage instanceof WebSocket) && socket && head) { // Wsproxy is handled here because if we're just passed the websocket then we don't even know it's URL
        // Compatibility with bare like "handle upgrade" syntax
        wss.handleUpgrade(wsOrIncomingMessage, socket as Socket, head, (ws: WebSocket): void => {
            if (!wsOrIncomingMessage.url?.endsWith("/")) { // if a URL ends with / then its not a wsproxy connection, its wisp
                handleWsProxy(ws, wsOrIncomingMessage.url!)
                return;
            }
            routeRequest(ws);
        });
        return;
    }
    if (!(wsOrIncomingMessage instanceof WebSocket)) return; // something went wrong, abort

    const ws = wsOrIncomingMessage as WebSocket; // now that we are SURE we have a Websocket object, continue...

    const connections = new Map();

    ws.on("message", (data, isBinary) => {
        try {
            // Ensure that the incoming data is a valid WebSocket message
            if (!Buffer.isBuffer(data) && !(data instanceof ArrayBuffer)) {
                console.error("Invalid WebSocket message data");
                return;
            }

            const wispFrame = FrameParsers.wispFrameParser(Buffer.from(data as Buffer));

            // Routing
            if (wispFrame.type === CONNECT_TYPE.CONNECT) {
                // CONNECT frame data
                const connectFrame = FrameParsers.connectPacketParser(wispFrame.payload);

                if (connectFrame.streamType === STREAM_TYPE.TCP) {
                    // Initialize and register Socket that will handle this stream
                    const client = new net.Socket();
                    client.connect(connectFrame.port, connectFrame.hostname);
                    connections.set(wispFrame.streamID, {
                        client: client,
                        buffer: 127,
                    });

                    // Send Socket's data back to client
                    client.on("data", function (data) {
                        ws.send(FrameParsers.dataPacketMaker(wispFrame, data));
                    });

                    // close stream if there is some network error
                    client.on("error", function () {
                        console.error("Something went wrong");
                        ws.send(FrameParsers.closePacketMaker(wispFrame, 0x03)); // 0x03 in the WISP protocol is defined as network error
                        connections.delete(wispFrame.streamID);
                    });
                } else if (connectFrame.streamType === STREAM_TYPE.UDP) {
                    // Create a new UDP socket
                    const client = dgram.createSocket('udp4');

                    // Bind the UDP socket to a random available port
                    client.bind(() => {
                        const address = client.address();
                        console.log(`UDP socket bound to ${address.address}:${address.port}`);

                        // Handle incoming UDP data
                        client.on('message', (data, rinfo) => {
                            ws.send(FrameParsers.dataPacketMaker(wispFrame, data));
                        });

                        // Handle errors
                        client.on('error', (err) => {
                            console.error('UDP error:', err);
                            ws.send(FrameParsers.closePacketMaker(wispFrame, 0x03));
                            connections.delete(wispFrame.streamID);
                            client.close();
                        });

                        // Store the UDP socket in the connections map
                        connections.set(wispFrame.streamID, {
                            client,
                            buffer: 127,
                        });
                    });
                }
            }
            if (wispFrame.type === CONNECT_TYPE.DATA) {
                const stream = connections.get(wispFrame.streamID);
                if (stream && stream.client instanceof net.Socket) {
                    stream.client.write(wispFrame.payload);
                    stream.buffer--;

                    if (stream.buffer === 0) {
                        stream.buffer = 127;
                        ws.send(continuePacketMaker(wispFrame, stream.buffer));
                    }
                } else if (stream && stream.client instanceof dgram.Socket) {
                    // Send UDP data
                    const connectFrame = FrameParsers.connectPacketParser(wispFrame.payload);
                    if (connectFrame.port > 0 && connectFrame.port < 65536) {
                        stream.client.send(wispFrame.payload, connectFrame.port, connectFrame.hostname);
                    } else {
                        console.error(`Invalid port number: ${connectFrame.port}`);
                    }
                }
            }
            if (wispFrame.type === CONNECT_TYPE.CLOSE) {
                // its joever
                console.log(
                    "Client decided to terminate with reason " + new DataView(wispFrame.payload.buffer).getUint8(0),
                );
                const stream = connections.get(wispFrame.streamID);
                if (stream && stream.client instanceof net.Socket) {
                    stream.client.destroy();
                } else if (stream && stream.client instanceof dgram.Socket) {
                    stream.client.close();
                }
                connections.delete(wispFrame.streamID);
            }
        } catch (e) {
            ws.close(); // something went SUPER wrong, like its probably not even a wisp connection
            console.error("WISP incoming message handler error: ");
            console.error(e);

            // cleanup
            for (const { client } of connections.values()) {
                if (client instanceof net.Socket) {
                    client.destroy();
                } else if (client instanceof dgram.Socket) {
                    client.close();
                }
            }
            connections.clear();
        }
    });

    // Close all open sockets when the WebSocket connection is closed
    ws.on("close", () => {
        for (const { client } of connections.values()) {
            if (client instanceof net.Socket) {
                client.destroy();
            } else if (client instanceof dgram.Socket) {
                client.close();
            }
        }
        connections.clear();
    });

    // SEND the initial continue packet with streamID 0 and 127 queue limit
    ws.send(FrameParsers.continuePacketMaker({ streamID: 0 } as WispFrame, 127));
}

export default {
    routeRequest,
}