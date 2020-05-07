import { DEFAULT_PREFIX } from "./actionTypes";

/* eslint max-classes-per-file: "off" */
/* eslint import/prefer-default-export: "off" */

export class WebSocketNotInitialized extends Error {
    constructor(message?: string) {
        super(message);
        this.message = message || `Socket connection not initialized. Dispatch ${DEFAULT_PREFIX}_CONNECT first`;
        this.name = "WebSocketNotInitialized";
    }
}
