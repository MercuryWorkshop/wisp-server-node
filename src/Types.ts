export type WispFrame = {
    type: CONNECT_TYPE;
    streamID: number;
    payload: Uint8Array;
};

export enum CONNECT_TYPE {
    CONNECT = 0x01,
    DATA = 0x02,
    CONTINUE = 0x03,
    CLOSE = 0x04,
    INFO = 0x05,
}

export enum STREAM_TYPE {
    TCP = 0x01,
    UDP = 0x02,
}

export type WispOptions = {
    logging?: boolean;
    auth?: boolean;
    throttle?: boolean;
    throttleLimit?: number;
    throttleInterval?: number;
};

export type ExtensionInfo = {
    id: number;
    payload: Uint8Array;
};
