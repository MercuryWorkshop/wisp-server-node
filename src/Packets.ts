import { CONNECT_TYPE, WispFrame, ExtensionInfo } from "./Types";

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

export function infoPacketMaker(extensions: ExtensionInfo[]) {
    const infoPacket = new DataView(new Uint8Array(9).buffer); // 1 byte for type, 2 for version, 4 for extensions length, 2 for extensions data
    infoPacket.setUint8(0, CONNECT_TYPE.INFO);
    infoPacket.setUint8(1, 2); // Major Version
    infoPacket.setUint8(2, 0); // Minor Version

    let extensionDataLength = 0;
    for (const extension of extensions) {
        extensionDataLength += extension.payload.byteLength + 5; // 5 bytes for header
    }

    infoPacket.setUint32(3, extensionDataLength, true); // length of the extensions array

    // Generate the extensions data
    let extensionsData = new Uint8Array(extensionDataLength);
    let currentPosition = 0;
    for (const extension of extensions) {
        extensionsData.set([extension.id], currentPosition);
        currentPosition += 1;

        const payloadLengthView = new DataView(new Uint8Array(4).buffer);
        payloadLengthView.setUint32(0, extension.payload.byteLength, true);
        extensionsData.set(new Uint8Array(payloadLengthView.buffer), currentPosition);
        currentPosition += 4;

        extensionsData.set(extension.payload, currentPosition);
        currentPosition += extension.payload.byteLength;
    }

    return Buffer.concat([Buffer.from(infoPacket.buffer), extensionsData]);
}

export function authPacketMaker(success: boolean) {
    const authPacket = new DataView(new Uint8Array(2).buffer); // 1 byte for type, 1 for success
    authPacket.setUint8(0, CONNECT_TYPE.INFO);
    authPacket.setUint8(1, success ? 1 : 0);
    return authPacket.buffer;
}

export function authPacketParser(payload: Uint8Array) {
    const dataView = new DataView(payload.buffer);
    const usernameLength = dataView.getUint8(0);
    const passwordLength = dataView.getUint16(1, true);
    const usernameString = new TextDecoder("utf8").decode(dataView.buffer.slice(3, 3 + usernameLength));
    const passwordString = new TextDecoder("utf8").decode(
        dataView.buffer.slice(3 + usernameLength, 3 + usernameLength + passwordLength),
    );
    return {
        username: usernameString,
        password: passwordString,
    };
}

export default {
    wispFrameParser,
    connectPacketParser,
    continuePacketMaker,
    closePacketMaker,
    dataPacketMaker,
    infoPacketMaker,
    authPacketMaker,
    authPacketParser,
};
