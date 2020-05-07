import { Dispatch, MiddlewareAPI } from "redux";
import { WebSocketNotInitialized } from "./errors";
import {
    beginReconnect,
    broken,
    closed,
    error,
    open,
    reconnectAttempt,
    reconnected,
    rpcNotification,
    rpcMethod,
} from "./actions";
import { Action } from "./types";

interface Options {
    prefix: string;
    reconnectInterval: number;
    reconnectOnClose: boolean;
    onOpen?: (s: WebSocket) => void;
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
    [x: string]: QueueElement;
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
    private websocket: WebSocket | null = null;

    // Keep track of how many times we"ve attempted to reconnect.
    private reconnectCount: number = 0;

    // We"ll create an interval to try and reconnect if the socket connection breaks.
    private reconnectionInterval: NodeJS.Timeout | null = null;

    // Keep track of the last URL we connected to, so that when we automatically
    // try to reconnect, we can connect to the correct URL.
    private lastSocketUrl: string | null = null;

    // Keep track of if the WebSocket connection has ever successfully opened.
    private hasOpened = false;

    // RPC Methods response waiting queue
    private readonly queue: Queue;

    // After this time error will dispatched
    private methodTimeout: number = 3000;

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
    connect = ({ dispatch }: MiddlewareAPI, { payload }: Action) => {
        this.close();

        const { prefix } = this.options;

        this.lastSocketUrl = payload.url;
        this.websocket = new WebSocket(payload.url, payload.protocols || undefined);

        this.websocket.addEventListener("close", event => this.handleClose(dispatch, prefix, event));
        this.websocket.addEventListener("error", () => this.handleError(dispatch, prefix));
        this.websocket.addEventListener("open", event => {
            this.handleOpen(dispatch, prefix, this.options.onOpen, event);
        });
        this.websocket.addEventListener("message", event => {
            this.handleMessage(dispatch, prefix, event);
        });
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

    private buildRpcFrame = (method: string, params: any, id: any = undefined) =>
        JSON.stringify({
            jsonrpc: "2.0",
            method,
            params,
            id,
        });

    private callMethod = (method: string, payload: any, id: any) =>
        new Promise<any>((resolve, reject) => {
            if (this.websocket) {
                this.websocket.send(this.buildRpcFrame(method, payload, id));
                this.queue[id] = { promise: [resolve, reject] };
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
    sendMethod = ({ dispatch }: MiddlewareAPI, { payload, meta }: Action) => {
        const id = (Math.round(Math.random() * 10000000)).toString();

        const methodName = meta.method.toUpperCase();

        this.callMethod(meta.method, payload, id)
            .then(({ result, prefix }) => dispatch(rpcMethod(result, prefix, methodName)))
            .catch(err => dispatch({ type: `METHOD_${methodName}_ERROR`, payload: err }));
    };

    /**
     * Call rpc notification
     *
     * @param {MiddlewareAPI} store
     * @param {Action} action
     *
     * @throws {Error} Socket connection must exist.
     */
    sendNotification = (store: MiddlewareAPI, { payload, meta }: Action) => {
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
    private handleClose = (dispatch: Dispatch, prefix: string, event: Event) => {
        dispatch(closed(event, prefix));

        // Conditionally attempt reconnection if enabled and applicable
        const { reconnectOnClose } = this.options;
        if (reconnectOnClose && this.canAttemptReconnect()) {
            this.handleBrokenConnection(dispatch);
        }
    };

    /**
     * Handle an error event.
     *
     * @param {Dispatch} dispatch
     * @param {string} prefix
     */
    private handleError = (dispatch: Dispatch, prefix: string) => {
        dispatch(error(null, new Error("`redux-websocket` error"), prefix));
        if (this.canAttemptReconnect()) {
            this.handleBrokenConnection(dispatch);
        }
    };

    /**
     * Handle an open event.
     *
     * @param {Dispatch} dispatch
     * @param {string} prefix
     * @param {(s: WebSocket) => void | undefined} onOpen
     * @param {Event} event
     */
    private handleOpen = (
        dispatch: Dispatch,
        prefix: string,
        onOpen: ((s: WebSocket) => void) | undefined,
        event: Event,
    ) => {
        // Clean up any outstanding reconnection attempts.
        if (this.reconnectionInterval) {
            clearInterval(this.reconnectionInterval);

            this.reconnectionInterval = null;
            this.reconnectCount = 0;

            dispatch(reconnected(prefix));
        }

        // Hook to allow consumers to get access to the raw socket.
        if (onOpen && this.websocket != null) {
            onOpen(this.websocket);
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
        const { id, result, method } = data;

        if (id && !method && (result || data.error) && this.queue[id]) {
            const { timeout, promise } = this.queue[id];
            const [resolve, reject] = promise;
            if (timeout) {
                clearTimeout(timeout);
            }
            if (data.error) {
                reject(data.error);
            } else {
                resolve({ result, prefix });
            }
            delete this.queue[id];
        } else if (!id && method) {
            dispatch(rpcNotification(event, prefix, method));
        } else {
            console.error("Unknown message type");
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
            this.websocket.close(code || 1000, reason || "WebSocket connection closed by redux-websocket.");

            this.websocket = null;
            this.hasOpened = false;
        }
    };

    /**
     * Handle a broken socket connection.
     * @private
     *
     * @param {Dispatch} dispatch
     */
    private handleBrokenConnection = (dispatch: Dispatch) => {
        const { prefix, reconnectInterval } = this.options;

        this.websocket = null;

        // First, dispatch actions to notify Redux that our connection broke.
        dispatch(broken(prefix));
        dispatch(beginReconnect(prefix));

        this.reconnectCount = 1;

        dispatch(reconnectAttempt(this.reconnectCount, prefix));

        // Attempt to reconnect immediately by calling connect with assertions
        // that the arguments conform to the types we expect.
        this.connect(
            { dispatch } as MiddlewareAPI,
            { payload: { url: this.lastSocketUrl } } as Action,
        );

        // Attempt reconnecting on an interval.
        this.reconnectionInterval = setInterval(() => {
            this.reconnectCount += 1;

            dispatch(reconnectAttempt(this.reconnectCount, prefix));

            // Call connect again, same way.
            this.connect(
                { dispatch } as MiddlewareAPI,
                { payload: { url: this.lastSocketUrl } } as Action,
            );
        }, reconnectInterval);
    };

    // Only attempt to reconnect if the connection has ever successfully opened,
    // and we"re not currently trying to reconnect.
    //
    // This prevents ongoing reconnect loops to connections that have not
    // successfully opened before, such as net::ERR_CONNECTION_REFUSED errors.
    //
    // This also prevents starting multiple reconnection attempt loops.
    private canAttemptReconnect(): boolean {
        return this.hasOpened && this.reconnectionInterval == null;
    }
}
