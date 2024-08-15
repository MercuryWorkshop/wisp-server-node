import { STREAM_TYPE, CONNECT_TYPE, WispFrame } from "./Types";

export function wispFrameParser(data: Buffer): WispFrame {
    const uint8arrayView = new Uint8Array(data);
    const dataView = new DataView(uint8arrayView.buffer);
    const type: CONNECT_TYPE = dataView.getUint8(0);
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
    initialPacket.setUint8(0, CONNECT_TYPE.CONTINUE);
    initialPacket.setUint32(1, wispFrame.streamID, true);
    initialPacket.setUint32(5, queue, true);
    return initialPacket.buffer;
}
export function closePacketMaker(wispFrame: WispFrame, reason: number) {
    const closePacket = new DataView(new Uint8Array(9).buffer);
    closePacket.setUint8(0, CONNECT_TYPE.CLOSE);
    closePacket.setUint32(1, wispFrame.streamID, true);
    closePacket.setUint8(5, reason);

    return closePacket.buffer;
}
export function dataPacketMaker(wispFrame: WispFrame, data: Buffer) {
    // Only function here that returns a node buffer instead ArrayBufferLike
    // Packet header creation
    const dataPacketHeader = new DataView(new Uint8Array(5).buffer);
    dataPacketHeader.setUint8(0, CONNECT_TYPE.DATA);
    dataPacketHeader.setUint32(1, wispFrame.streamID, true); // Technically should be uint32 little endian, but libcurl bug

    // Combine the data and the packet header and send to client
    return Buffer.concat([Buffer.from(dataPacketHeader.buffer), data]);
}
export function infoPacketMaker() {
    // Hardcoding in the UDP extension
    const infoPacket = new DataView(new Uint8Array(12).buffer);
    infoPacket.setUint8(0, CONNECT_TYPE.INFO);
    // initialPacket.setUint32(1, 0, true); - streamID is always zero
    infoPacket.setUint8(5, 2);
    infoPacket.setUint8(6, 0);
    // UDP extension
    infoPacket.setUint8(7, 1);
    // initialPacket.setUint32(8, 0, true); - payload length is always zero
    return infoPacket.buffer;
}

export default {
    wispFrameParser,
    connectPacketParser,
    continuePacketMaker,
    closePacketMaker,
    dataPacketMaker,
    infoPacketMaker,
};
