import { PACKET_TYPE, WispFrame } from "./Types.js";

export function wispFrameParser(data: Buffer): WispFrame {
    const uint8arrayView = new Uint8Array(data);
    const dataView = new DataView(uint8arrayView.buffer);
    const type: PACKET_TYPE = dataView.getUint8(0);
    let streamID = dataView.getUint32(1, true);
    let payload = uint8arrayView.slice(5, uint8arrayView.byteLength);

    return {
        type,
        streamID,
        payload,
    };
}

export function connectPacketParser(payload: Uint8Array) {
    const dataview = new DataView(payload.buffer);
    const streamType = dataview.getUint8(0); // for future use, makes it easier to retrofit UDP support
    const port = dataview.getUint16(1, true);
    const hostname = new TextDecoder("utf8").decode(dataview.buffer.slice(3, dataview.buffer.byteLength));
    return {
        dataview,
        streamType,
        port,
        hostname,
    };
}
export function continuePacketMaker(wispFrame: WispFrame, queue: number) {
    const initialPacket = new DataView(new Uint8Array(9).buffer);
    initialPacket.setUint8(0, PACKET_TYPE.CONTINUE);
    initialPacket.setUint32(1, wispFrame.streamID, true);
    initialPacket.setUint32(5, queue, true);
    return initialPacket.buffer;
}
export function closePacketMaker(wispFrame: WispFrame, reason: number) {
    const closePacket = new DataView(new Uint8Array(9).buffer);
    closePacket.setUint8(0, PACKET_TYPE.CLOSE);
    closePacket.setUint32(1, wispFrame.streamID, true);
    closePacket.setUint8(5, reason);

    return closePacket.buffer;
}
// the data is any because i want to build this shit without typescript screaming at me
export function dataPacketMaker(wispFrame: WispFrame, data: any) {
    // Only function here that returns a node buffer instead ArrayBufferLike
    // Packet header creation
    const dataPacketHeader = new DataView(new Uint8Array(5).buffer);
    dataPacketHeader.setUint8(0, PACKET_TYPE.DATA);
    dataPacketHeader.setUint32(1, wispFrame.streamID, true); // Technically should be uint32 little endian, but libcurl bug

    // Combine the data and the packet header and send to client
    return Buffer.concat([Buffer.from(dataPacketHeader.buffer), data]);
}

export default {
    wispFrameParser,
    connectPacketParser,
    continuePacketMaker,
    closePacketMaker,
    dataPacketMaker,
};
