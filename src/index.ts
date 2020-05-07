import { connect, disconnect, rpcMethod, rpcNotify } from "./actions";
import createMiddleware from "./createMiddleware";

export * from "./actionTypes";
// noinspection JSUnusedGlobalSymbols
export {
    connect,
    disconnect,
    rpcMethod,
    rpcNotify,
    createMiddleware as default,
};
