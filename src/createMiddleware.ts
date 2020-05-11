import { Middleware, MiddlewareAPI } from "redux";
import { Action, Options } from "./types";
import { error } from "./actions";
import * as actionTypes from "./actionTypes";
import ReduxWsJsonRpc from "./ReduxWsJsonRpc";

/**
 * Default middleware creator options.
 * @private
 */
const defaultOptions = {
    reconnectInterval: 2000,
    reconnectOnClose: false,
    prefix: actionTypes.DEFAULT_PREFIX,
    rpcTimeout: 3000,
};

/**
 * Create a middleware.
 *
 * @param {Options} rawOptions
 *
 * @returns {Middleware}
 */
export default (rawOptions?: Options): Middleware => {
    const options = {...defaultOptions, ...rawOptions};
    const {prefix} = options;
    const actionPrefixExp = RegExp(`^${prefix}::`);

    // Create a new redux websocket instance.
    const reduxWebsocket = new ReduxWsJsonRpc(options);

    // Define the list of handlers, now that we have an instance of ReduxWebSocket.
    const handlers = {
        [actionTypes.WEBSOCKET_CONNECT]: reduxWebsocket.connect,
        [actionTypes.WEBSOCKET_DISCONNECT]: reduxWebsocket.disconnect,
        [actionTypes.WEBSOCKET_SEND_METHOD]: reduxWebsocket.sendMethod,
        [actionTypes.WEBSOCKET_SEND_NOTIFICATION]: reduxWebsocket.sendNotification,
    };

    // Middleware function.
    return (store: MiddlewareAPI) => next => (action: Action) => {
        const {dispatch} = store;
        const { type: actionType } = action;

        // Check if action type matches prefix
        if (actionType && actionType.match(actionPrefixExp)) {
            const baseActionType = action.type.replace(actionPrefixExp, "");
            const handler = Reflect.get(handlers, baseActionType);

            if (handler) {
                try {
                    handler(store, action);
                } catch (err) {
                    dispatch(error(action, err, prefix));
                }
            }
        }
        return next(action);
    };
};
