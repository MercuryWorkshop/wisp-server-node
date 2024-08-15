import { STREAM_TYPE, CONNECT_TYPE, LOG_LEVEL, WispFrame, WispOptions } from "./Types";
import { Logger } from "./Logger";
import WebSocket, { WebSocketServer } from "ws";
import net, { Socket } from "node:net";
import dgram from "node:dgram";
import { IncomingMessage } from "node:http";
import FrameParsers, { closePacketMaker, continuePacketMaker, dataPacketMaker } from "./Packets";
import { handleWsProxy } from "./wsproxy";
import dns from "node:dns/promises";

const wss = new WebSocket.Server({ noServer: true });
const defaultOptions: WispOptions = { logLevel: LOG_LEVEL.INFO };
// Accepts either routeRequest(ws) or routeRequest(request, socket, head) like bare
export async function routeRequest(
    wsOrIncomingMessage: WebSocket | IncomingMessage,
    socket?: Socket,
    head?: Buffer,
    options: WispOptions = defaultOptions,
) {
    options = Object.assign({}, defaultOptions, options);

    if (!(wsOrIncomingMessage instanceof WebSocket) && socket && head) {
        // Wsproxy is handled here because if we're just passed the websocket then we don't even know it's URL
        // Compatibility with bare like "handle upgrade" syntax
        wss.handleUpgrade(wsOrIncomingMessage, socket as Socket, head, (ws: WebSocket): void => {
            if (!wsOrIncomingMessage.url?.endsWith("/")) {
                // if a URL ends with / then its not a wsproxy connection, its wisp
                handleWsProxy(ws, wsOrIncomingMessage.url!);
                return;
            }
            routeRequest(ws, undefined, undefined, options);
        });
        return;
    }

    if (!(wsOrIncomingMessage instanceof WebSocket)) return; // something went wrong, abort

    const ws = wsOrIncomingMessage as WebSocket; // now that we are SURE we have a Websocket object, continue...

    const logger = new Logger(options.logLevel);

    const connections = new Map();
    let handshakeCompleted = false;
    let udpExtensionEnabled = false;

    // fallback to wisp v1 after 5 seconds
    setTimeout(()=>{
        if (!handshakeCompleted) {
            logger.warn("Not a wisp v2 connection. what are you even doing??");
            handshakeCompleted = true;
            udpExtensionEnabled = true;
        }
    }, 5000);

    ws.on("message", async (data, isBinary) => {
        try {
            // Ensure that the incoming data is a valid WebSocket message
            if (!Buffer.isBuffer(data) && !(data instanceof ArrayBuffer)) {
                logger.error("Invalid WebSocket message data");
                return;
            }

            const wispFrame = FrameParsers.wispFrameParser(Buffer.from(data as Buffer));
            if (!handshakeCompleted) {
                // don't parse anything else until handshake is done
                if (wispFrame.type === CONNECT_TYPE.INFO && wispFrame.streamID === 0) {
                    const dataView = new DataView(wispFrame.payload.buffer);
                    // check major version
                    if (dataView.getUint8(0) !== 2) {
                        console.error("this version of wisp is not supported");
                        ws.close();
                        return;
                    }
                    for (let i = 2; i < dataView.byteLength;) {
                        console.info("Found extension " + dataView.getUint8(i));
                        if (dataView.getInt8(i) === 1) {
                            udpExtensionEnabled = true;
                        }
                        i += dataView.getUint32(i+1, true) + 5;
                    }
                    handshakeCompleted = true;
                    return;
                } else {
                    console.warn("Not a wisp v2 connection. what are you even doing??");
                    handshakeCompleted = true;
                    udpExtensionEnabled = true;
                }
            }

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

                    // Close stream if there is some network error
                    client.on("error", function (err) {
                        logger.error(
                            `An error occured in the connection to ${connectFrame.hostname} (${wispFrame.streamID}) with the message ${err.message}`,
                        );
                        ws.send(FrameParsers.closePacketMaker(wispFrame, 0x03)); // 0x03 in the WISP protocol is defined as network error
                        connections.delete(wispFrame.streamID);
                    });
                    client.on("close", function () {
                        ws.send(FrameParsers.closePacketMaker(wispFrame, 0x02));
                        connections.delete(wispFrame.streamID);
                    });
                } else if (connectFrame.streamType === STREAM_TYPE.UDP && udpExtensionEnabled) {
                    let iplevel = net.isIP(connectFrame.hostname); // Can be 0: DNS NAME, 4: IPv4, 6: IPv6
                    let host = connectFrame.hostname;

                    if (iplevel === 0) {
                        // is DNS
                        try {
                            host = (await dns.resolve(connectFrame.hostname))[0];
                            iplevel = net.isIP(host); // can't be 0 now
                        } catch (e) {
                            logger.error(
                                "Failure while trying to resolve hostname " +
                                    connectFrame.hostname +
                                    " with error: " +
                                    e,
                            );
                            ws.send(FrameParsers.closePacketMaker(wispFrame, 0x42));
                            return; // we're done here, ignore doing anything to this message now.
                        }
                    }

                    // iplevel is now guaranteed to be 6 or 4, fingers crossed, so we can define the UDP type now
                    if (iplevel != 4 && iplevel != 6) {
                        return; // something went wrong.. neither ipv4 nor ipv6
                    }

                    // Create a new UDP socket
                    const client = dgram.createSocket(iplevel === 6 ? "udp6" : "udp4");
                    client.connect(connectFrame.port, host);
                    //@ts-expect-error stupid workaround
                    client.connected = false;

                    client.on("connect", () => {
                        //@ts-expect-error really dumb workaround
                        client.connected = true;
                    });
                    // Handle incoming UDP data
                    client.on("message", (data, rinfo) => {
                        ws.send(FrameParsers.dataPacketMaker(wispFrame, data));
                    });

                    // Handle errors
                    client.on("error", (err) => {
                        logger.error(
                            `An error occured in the connection to ${connectFrame.hostname} (${wispFrame.streamID}) with the message ${err.message}`,
                        );
                        ws.send(FrameParsers.closePacketMaker(wispFrame, 0x03));
                        connections.delete(wispFrame.streamID);
                        client.close();
                    });

                    client.on("close", function () {
                        ws.send(FrameParsers.closePacketMaker(wispFrame, 0x02));
                        connections.delete(wispFrame.streamID);
                    });

                    // Store the UDP socket and connectFrame in the connections map
                    connections.set(wispFrame.streamID, {
                        client,
                    });
                } else {
                    ws.send(FrameParsers.closePacketMaker(wispFrame, 0x41));
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
                    stream.client.send(wispFrame.payload, undefined, undefined, (err: Error | null) => {
                        if (err) {
                            ws.send(FrameParsers.closePacketMaker(wispFrame, 0x03));
                            if (stream.client.connected) {
                                stream.client.close();
                            }
                            connections.delete(wispFrame.streamID);
                        }
                    });
                }
            }

            if (wispFrame.type === CONNECT_TYPE.CLOSE) {
                // its joever
                logger.log(
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
            logger.error(`WISP incoming message handler error: `, e);

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
    ws.on("close", (code, reason) => {
        logger.debug(`WebSocket connection closed with code ${code} and reason: ${reason}`);
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
    // SEND the initial info packet with udp extension
    ws.send(FrameParsers.infoPacketMaker());
}

export default {
    routeRequest,
};
