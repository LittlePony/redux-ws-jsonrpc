import { Dispatch, MiddlewareAPI } from "redux";
import { WebSocketNotInitialized } from "./errors";
import {
    broken,
    closed,
    error,
    open,
    reconnecting,
    reconnected,
    rpcNotification,
    rpcMethod,
} from "./actions";
import {
    Action,
    AfterCloseParams,
    AfterCloseOptions,
    BeforeReconnectParams,
    BeforeReconnectOptions,
    Queue,
} from "./types";

interface Options {
    prefix: string;
    reconnectInterval: number;
    reconnectOnClose: boolean;
    afterClose?: (params: AfterCloseParams, d: Dispatch) => AfterCloseOptions;
    beforeReconnect?: (params: BeforeReconnectParams, d: Dispatch) => BeforeReconnectOptions;
    rpcTimeout: number;
}

/**
 * ReduxWebSocket
 * @class
 *
 * Manages a WebSocket connection.
 */
export default class ReduxWsJsonRpc {
    // Class options.
    private readonly options: Options;

    // WebSocket connection.
    private websocket: WebSocket | undefined = undefined;

    // Keep track of how many times we"ve attempted to reconnect.
    private reconnectCount: number = 0;

    // We"ll create an interval to try and reconnect if the socket connection breaks.
    private reconnectTimeout: NodeJS.Timeout | undefined = undefined;

    // RPC Methods response waiting queue
    private readonly queue: Queue;

    // RPC method id with autoincrement
    private methodId: number = 0;

    /**
     * Constructor
     * @constructor
     *
     * @param {Options} options
     */
    constructor(options: Options) {
        this.options = options;
        this.queue = {};
    }

    /**
     * WebSocket connect event handler.
     *
     * @param {MiddlewareAPI} store
     * @param {Action} action
     */
    connect = ({dispatch}: MiddlewareAPI, {payload}: Action) => {
        this.close();
        const {prefix} = this.options;
        this.websocket = payload.protocols
            ? new WebSocket(payload.url, payload.protocols)
            : new WebSocket(payload.url);

        this.websocket.addEventListener("close", event =>
            this.handleClose(dispatch, prefix, event));
        this.websocket.addEventListener("error", () =>
            this.handleError(dispatch, prefix));
        this.websocket.addEventListener("open", event =>
            this.handleOpen(dispatch, prefix, event));
        this.websocket.addEventListener("message", event =>
            this.handleMessage(dispatch, prefix, event));
    };

    /**
     * WebSocket disconnect event handler.
     *
     */
    disconnect = () => {
        this.clearTimeout();
        this.websocket && this.close();
    };

    /**
     * Create JSON-RPC 2.0 compatible message
     *
     * @param {string} method
     * @param {any} params
     * @param {number} id
     */
    private buildRpcFrame = (
        method: string,
        params: any,
        id: number | undefined = undefined,
    ) => JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
        id,
    });

    private callMethod = (method: string, payload: any, id: number) =>
        new Promise<any>((resolve, reject) => {
            if (this.websocket) {
                this.websocket.send(this.buildRpcFrame(method, payload, id));
                this.queue[id] = {promise: [resolve, reject]};
                this.queue[id].method = method;
                this.queue[id].timeout = setTimeout(() => {
                    delete this.queue[id];
                    reject(new Error("Server response timeout"));
                }, this.options.rpcTimeout);
            } else {
                throw new WebSocketNotInitialized();
            }
        });

    /**
     * Call rpc method and await response
     *
     * @param {MiddlewareAPI} store
     * @param {Action} action
     */
    sendMethod = ({dispatch}: MiddlewareAPI, {payload, meta}: Action) => {
        this.methodId += 1;
        const methodName = meta.method.toUpperCase();
        this.callMethod(meta.method, payload, this.methodId)
            .then(({result, prefix}) => dispatch(rpcMethod(result, prefix, methodName)))
            .catch(err => dispatch({type: `METHOD_${methodName}_ERROR`, payload: err}));
    };

    /**
     * Call rpc notification
     *
     * @param {MiddlewareAPI} store
     * @param {Action} action
     *
     * @throws {Error} Socket connection must exist.
     */
    sendNotification = (store: MiddlewareAPI, {payload, meta}: Action) => {
        if (this.websocket) {
            this.websocket.send(this.buildRpcFrame(meta.method, payload));
        } else {
            throw new WebSocketNotInitialized();
        }
    };

    /**
     * Handle a close event.
     *
     * @param {Dispatch} dispatch
     * @param {string} prefix
     * @param {Event} event
     */
    private handleClose = (dispatch: Dispatch, prefix: string, event: CloseEvent) => {
        const lastUrl = (event.target as WebSocket).url;
        const {reconnectCount} = this;

        dispatch(closed(event, prefix));

        // "dirty" closed connection
        if (!event.wasClean) {
            // Notify Redux that our connection broke.
            reconnectCount === 0 && dispatch(broken(prefix));

            // get new options if callback is defined
            const options = this.options.afterClose
                && this.options.afterClose({lastUrl, reconnectCount}, dispatch);

            // Schedule reconnection attempt if enabled (through constructor or callback)
            if (options?.reconnectOnClose
                || (this.options.reconnectOnClose && options?.reconnectOnClose === undefined)) {
                const interval = options?.reconnectInterval || this.options.reconnectInterval;
                this.scheduleReconnect(dispatch, lastUrl, interval);
            }
        }
    };

    /**
     * Handle an error event.
     *
     * @param {Dispatch} dispatch
     * @param {string} prefix
     */
    private handleError = (dispatch: Dispatch, prefix: string) =>
        dispatch(error(null, new Error("WebSocket error"), prefix));

    /**
     * Reconnection attempt
     *
     * @param {Dispatch} dispatch
     * @param {string} lastUrl
     */
    private reconnect = (dispatch: Dispatch, lastUrl: string) => {
        this.reconnectTimeout = undefined;
        dispatch(reconnecting(this.reconnectCount, this.options.prefix));

        // get new options if callback is defined
        const {beforeReconnect} = this.options;
        const options = beforeReconnect && beforeReconnect({lastUrl}, dispatch);
        const url = options?.url || lastUrl;

        this.connect(
            {dispatch} as MiddlewareAPI,
            {payload: {url}} as Action,
        );
    };

    /**
     * Handle a broken socket connection.
     * @param {Dispatch} dispatch
     * @param {string} lastUrl
     * @param {number} interval
     */
    private scheduleReconnect = (dispatch: Dispatch, lastUrl: string, interval: number) => {
        this.websocket = undefined;
        this.reconnectCount += 1;
        this.reconnectTimeout = setTimeout(
            () => this.reconnect(dispatch, lastUrl),
            interval,
        );
    };

    /**
     * Handle an open event.
     *
     * @param {Dispatch} dispatch
     * @param {string} prefix
     * @param {Event} event
     */
    private handleOpen = (
        dispatch: Dispatch,
        prefix: string,
        event: Event,
    ) => {
        // Clean up any outstanding reconnection attempts.
        this.clearTimeout();
        if (this.reconnectCount > 0) {
            this.reconnectCount = 0;
            dispatch(reconnected(prefix));
        }
        // Now we"re fully open and ready to send messages.
        dispatch(open(event, prefix));
    };

    /**
     * Handle a message event.
     * Detect message type (Called method response or notify request) and
     * dispatch action  respectively.
     * @param {Dispatch} dispatch
     * @param {string} prefix
     * @param {MessageEvent} event
     */
    private handleMessage = (
        dispatch: Dispatch,
        prefix: string,
        event: MessageEvent,
    ) => {
        const data = JSON.parse(event.data);
        const {id, result, method} = data;

        if (id && !method && (result || data.error) && this.queue[id]) { // Method response
            const {timeout, promise} = this.queue[id];
            const [resolve, reject] = promise;

            timeout && clearTimeout(timeout);
            data.error
                ? reject(new Error(data.error.message || "Unknown server error"))
                : resolve({result, prefix});
            delete this.queue[id];
        } else if (!id && method) { // Server notification
            dispatch(rpcNotification(event, prefix, method));
        } else {
            dispatch(error(null, new Error("Unknown server message type"), prefix));
        }
    };

    /**
     * Close the WebSocket connection.
     *
     * @param {number} [code]
     * @param {string} [reason]
     */
    private close = (code?: number, reason?: string) => {
        if (this.websocket) {
            this.websocket.close(code || 1000, reason || "Connection closed by client");
            this.websocket = undefined;
        }
    };

    private clearTimeout = () => {
        this.reconnectTimeout && clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = undefined;
    };
}
