/* eslint max-classes-per-file: "off" */
import { DEFAULT_PREFIX } from "./actionTypes";

export class WebSocketNotInitialized extends Error {
    constructor(message?: string) {
        super(message);
        this.message = message || `Socket connection not initialized. Dispatch ${DEFAULT_PREFIX}_CONNECT first`;
        this.name = "WebSocketNotInitializedError";
    }
}

export class UnknownMessageType extends Error {
    constructor(message?: string) {
        super(message);
        this.message = message || "Unknown server message type";
        this.name = "UnknownMessageTypeError";
    }
}

export class ServerRpcError extends Error {
    constructor(message?: string) {
        super(message);
        this.message = message || "Unknown server error";
        this.name = "ServerRpcError";
    }
}

export class WebSocketError extends Error {
    constructor(message?: string) {
        super(message);
        this.message = message || "WebSocket error";
        this.name = "WebSocketError";
    }
}

export class ServerTimeout extends Error {
    constructor(message?: string) {
        super(message);
        this.message = message || "Server response timeout";
        this.name = "ServerTimeoutError";
    }
}
