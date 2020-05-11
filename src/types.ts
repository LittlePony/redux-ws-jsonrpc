import {
    WEBSOCKET_CONNECT,
    WEBSOCKET_DISCONNECT,
    WEBSOCKET_MESSAGE,
    WEBSOCKET_OPEN,
    WEBSOCKET_SEND_METHOD,
    WEBSOCKET_SEND_NOTIFICATION,
} from "./actionTypes";

type Action =
    | { type: typeof WEBSOCKET_CONNECT, payload: any, meta: any }
    | { type: typeof WEBSOCKET_DISCONNECT, payload: any, meta: any }
    | { type: typeof WEBSOCKET_MESSAGE, payload: any, meta: any }
    | { type: typeof WEBSOCKET_OPEN, payload: any, meta: any }
    | { type: typeof WEBSOCKET_SEND_METHOD, payload: any, meta: any }
    | { type: typeof WEBSOCKET_SEND_NOTIFICATION, payload: any, meta: any };

export interface AfterCloseParams {
    wasClean: boolean;
    lastUrl: string;
    reconnectCount: number;
}

export interface AfterCloseOptions {
    reconnectInterval: number;
    reconnectOnClose: boolean;
}

export interface BeforeReconnectParams {

}

export interface BeforeReconnectOptions {

}

interface Options {
    prefix?: string;
    reconnectInterval?: number;
    reconnectOnClose?: boolean;
    afterClose?: () => void;
    beforeReconnect?: () => void;
    rpcTimeout?: number;
}

export {
    Action,
    Options,
};
