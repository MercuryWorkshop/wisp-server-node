import { STREAM_TYPE, CONNECT_TYPE, WispFrame, WispOptions, ExtensionInfo } from "./Types";
import WebSocket from "ws";
import net, { Socket } from "node:net";
import dgram from "node:dgram";
import { IncomingMessage } from "node:http";
import FrameParsers, { continuePacketMaker, infoPacketMaker, authPacketMaker, authPacketParser } from "./Packets";
import { handleWsProxy } from "./wsproxy";
import dns from "node:dns/promises";

// console.warn("wisp-server-node is now no longer maintained.");

const wss = new WebSocket.Server({ noServer: true });
const defaultOptions: WispOptions = { logging: true, auth: false, throttle: false, throttleLimit: 1024 * 1024, throttleInterval: 1000 };
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

  const connections = new Map();
  let authenticated = false;

  // Define supported extensions here
  const supportedExtensions: ExtensionInfo[] = [
    {
      id: 0x01,
      payload: new Uint8Array([]),
    },
    {
      id: 0x02,
      payload: new Uint8Array([]), // Empty payload for server
    },
  ];

  // Send info packet immediately
  ws.send(infoPacketMaker(supportedExtensions));

  // Handle incoming messages from the client
  ws.on("message", async (data, isBinary) => {
    try {
      // Ensure that the incoming data is a valid WebSocket message
      if (!Buffer.isBuffer(data) && !(data instanceof ArrayBuffer)) {
        if (options.logging) {
          console.error("Invalid WebSocket message data");
        }
        return;
      }

      const wispFrame = FrameParsers.wispFrameParser(Buffer.from(data as Buffer));

      if (!authenticated && options.auth) {
        if (wispFrame.type === CONNECT_TYPE.INFO) {
          // TODO: Implement actual authentication logic here
          authenticated = true;
          ws.send(authPacketMaker(true));
          if (options.logging) {
            console.log("Client successfully authenticated");
          }
        }
      } else {
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
              dataTransferred: 0,
              lastThrottleCheck: Date.now(),
            });

            // Send Socket's data back to client
            client.on("data", function (data) {
              ws.send(FrameParsers.dataPacketMaker(wispFrame, data));
              // Update data transferred
              connections.get(wispFrame.streamID)!.dataTransferred += data.length;
            });

            // Close stream if there is some network error
            client.on("error", function () {
              if (options.logging) {
                console.error("Something went wrong");
              }
              ws.send(FrameParsers.closePacketMaker(wispFrame, 0x03)); // 0x03 in the WISP protocol is defined as network error
              connections.delete(wispFrame.streamID);
            });
            client.on("close", function () {
              ws.send(FrameParsers.closePacketMaker(wispFrame, 0x02));
              connections.delete(wispFrame.streamID);
            });
          } else if (connectFrame.streamType === STREAM_TYPE.UDP) {
            let iplevel = net.isIP(connectFrame.hostname); // Can be 0: DNS NAME, 4: IPv4, 6: IPv6
            let host = connectFrame.hostname;

            if (iplevel === 0) {
              // is DNS
              try {
                host = (await dns.resolve(connectFrame.hostname))[0];
                iplevel = net.isIP(host); // can't be 0 now
              } catch (e) {
                if (options.logging) {
                  console.error(
                    "Failure while trying to resolve hostname " +
                      connectFrame.hostname +
                      " with error: " +
                      e,
                  );
                }
                return; // we're done here, ignore doing anything to this message now.
              }
            }

            // iplevel is now guaranteed to be 6 or 4, fingers crossed, so we can define the UDP type now
            if (iplevel != 4 && iplevel != 6) {
              return; // something went wrong.. neither ipv4 nor ipv6
            }

            // Create a new UDP socket
            const client = dgram.createSocket(iplevel === 6 ? "udp6" : "udp4");
            //@ts-expect-error stupid workaround
            client.connected = false;

            client.on("connect", () => {
              //@ts-expect-error really dumb workaround
              client.connected = true;
            });
            // Handle incoming UDP data
            client.on("message", (data, rinfo) => {
              ws.send(FrameParsers.dataPacketMaker(wispFrame, data));
              // Update data transferred
              connections.get(wispFrame.streamID)!.dataTransferred += data.length;
            });

            // Handle errors
            client.on("error", (err) => {
              if (options.logging) {
                console.error("UDP error:", err);
              }
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
              buffer: 127,
              connectFrame: connectFrame, // Store the connectFrame object
              dataTransferred: 0,
              lastThrottleCheck: Date.now(),
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
            // Update data transferred ONLY if the stream still exists in the map
            if (connections.has(wispFrame.streamID)) {
              connections.get(wispFrame.streamID)!.dataTransferred += wispFrame.payload.length;
            }
          } else if (stream && stream.client instanceof dgram.Socket) {
            const connectFrame = stream.connectFrame; // Retrieve the connectFrame object
            stream.client.send(
              wispFrame.payload,
              connectFrame.port,
              connectFrame.hostname,
              (err: Error | null) => {
                if (err) {
                  if (options.logging) {
                    console.error("UDP send error:", err);
                  }
                  ws.send(FrameParsers.closePacketMaker(wispFrame, 0x03));
                  if (stream.client.connected) {
                    stream.client.close();
                  }
                  connections.delete(wispFrame.streamID);
                }
              },
            );
            // Update data transferred
            stream.dataTransferred += wispFrame.payload.length;
          }
        }

        if (wispFrame.type === CONNECT_TYPE.CLOSE) {
          // its joever
          if (options.logging) {
            console.log(
              "Client decided to terminate with reason " +
                new DataView(wispFrame.payload.buffer).getUint8(0),
            );
          }
          const stream = connections.get(wispFrame.streamID);
          if (stream && stream.client instanceof net.Socket) {
            stream.client.destroy();
          } else if (stream && stream.client instanceof dgram.Socket) {
            stream.client.close();
          }
          connections.delete(wispFrame.streamID);
        }

        // Throttle if enabled and data transferred is over a certain threshold
        if (options.throttle) {
          for (const [_, stream] of connections.entries()) {
            const now = Date.now();

            // @ts-ignore - We are explicitly checking if throttleInterval is undefined
            const interval = options.throttleInterval !== undefined ? options.throttleInterval : defaultOptions.throttleInterval;

            // @ts-ignore - We are explicitly checking if throttleLimit is undefined
            const limit = options.throttleLimit !== undefined ? options.throttleLimit : defaultOptions.throttleLimit;

            if (now - stream.lastThrottleCheck >= interval!) {
              if (stream.dataTransferred >= limit!) {
                if (options.logging) {
                  if (stream.client instanceof net.Socket) {
                    console.log(`Throttling stream ID ${wispFrame.streamID} from ${stream.client.remoteAddress}:${stream.client.remotePort} due to excessive data transfer (elapsed time: ${now - stream.lastThrottleCheck}ms, data transferred: ${stream.dataTransferred} bytes)`);
                  } else if (stream.client instanceof dgram.Socket) {
                    console.log(`Throttling stream ID ${wispFrame.streamID} from ${stream.client.address}:${stream.client.port} due to excessive data transfer (elapsed time: ${now - stream.lastThrottleCheck}ms, data transferred: ${stream.dataTransferred} bytes)`);
                  }
                }
                // Close the connection before removing it from connections
                if (stream.client instanceof net.Socket) {
                  stream.client.destroy();
                } else if (stream.client instanceof dgram.Socket) {
                  stream.client.close();
                }
                // Remove the stream from the connections map AFTER closing
                connections.delete(stream.streamID);
              }

              stream.lastThrottleCheck = now;
            }
          }
        }

      }
    } catch (e) {
      ws.close(); // something went SUPER wrong, like its probably not even a wisp connection
      if (options.logging) {
        console.error("WISP incoming message handler error: ");
        console.error(e);
      }

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
    if (options.logging) {
      console.log(`WebSocket connection closed with code ${code} and reason: ${reason}`);
    }
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
};