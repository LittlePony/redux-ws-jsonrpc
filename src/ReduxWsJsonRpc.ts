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
import { Action } from "./types";

interface Options {
    prefix: string;
    reconnectInterval: number;
    reconnectOnClose: boolean;
    onReconnect?: () => void;
}

interface QueueElement {
    promise: [
        Parameters<ConstructorParameters<typeof Promise>[0]>[0],
        Parameters<ConstructorParameters<typeof Promise>[0]>[1]
    ];
    timeout?: ReturnType<typeof setTimeout>;
    method?: string;
}

interface Queue {
    [x: number]: QueueElement;
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

    // Keep track of if the WebSocket connection has ever successfully opened.
    private hasOpened = false;

    // RPC Methods response waiting queue
    private readonly queue: Queue;

    // After this time error will dispatched
    private methodTimeout: number = 3000;

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
        const { prefix } = this.options;
        this.websocket = new WebSocket(payload.url, payload.protocols || undefined);

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
     * @throws {Error} Socket connection must exist.
     */
    disconnect = () => {
        if (this.websocket) {
            this.close();
        } else {
            throw new WebSocketNotInitialized();
        }
    };

    /**
     * Create JSON-RPC 2.0 compatible message
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
                }, this.methodTimeout);
            } else {
                throw new WebSocketNotInitialized();
            }
        });

    /**
     * Call rpc method and await response
     *
     * @param {MiddlewareAPI} store
     * @param {Action} action
     *
     * @throws {Error} Socket connection must exist.
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
        dispatch(closed(event, prefix));

        // Notify Redux that our connection broke.
        this.reconnectCount === 0 && !event.wasClean
            && dispatch(broken(prefix));

        // Schedule reconnection attempt if enabled and "dirty" closed
        this.options.reconnectOnClose && !event.wasClean
            && this.scheduleReconnect(dispatch, lastUrl);
    };

    /**
     * Handle an error event.
     *
     * @param {Dispatch} dispatch
     * @param {string} prefix
     */
    private handleError = (dispatch: Dispatch, prefix: string) => {
        dispatch(error(null, new Error("WebSocket error"), prefix));
    };

    private reconnect = (dispatch: Dispatch, lastUrl: string) => {
        dispatch(reconnecting(this.reconnectCount, this.options.prefix));
        this.connect(
            {dispatch} as MiddlewareAPI,
            {payload: {url: lastUrl}} as Action,
        );
    };

    /**
     * Handle a broken socket connection.
     * @param {Dispatch} dispatch
     * @param {string} lastUrl
     */
    private scheduleReconnect = (dispatch: Dispatch, lastUrl: string) => {
        this.websocket = undefined;
        this.reconnectCount += 1;
        this.reconnectTimeout = setTimeout(
            () => this.reconnect(dispatch, lastUrl),
            this.options.reconnectInterval,
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
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = undefined;
            this.reconnectCount = 0;

            dispatch(reconnected(prefix));
        }
        // Now we"re fully open and ready to send messages.
        dispatch(open(event, prefix));

        // Track that we"ve been able to open the connection. We can use this flag
        // for error handling later, ensuring we don"t try to reconnect when a
        // connection was never able to open in the first place.
        this.hasOpened = true;
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

        if (id && !method && (result || data.error) && this.queue[id]) {
            const {timeout, promise} = this.queue[id];
            const [resolve, reject] = promise;

            timeout && clearTimeout(timeout);
            data.error
                ? reject(new Error(data.error.message || "Unknown server error"))
                : resolve({result, prefix});
            delete this.queue[id];
        } else if (!id && method) {
            dispatch(rpcNotification(event, prefix, method));
        } else {
            dispatch(error(null, new Error("Unknown server message type"), prefix));
        }
    };

    /**
     * Close the WebSocket connection.
     * @private
     *
     * @param {number} [code]
     * @param {string} [reason]
     */
    private close = (code?: number, reason?: string) => {
        if (this.websocket) {
            this.websocket.close(code || 1000, reason || "Connection closed by client");
            this.websocket = undefined;
            this.hasOpened = false;
        }
    };
}
