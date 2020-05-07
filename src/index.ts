import { connect, disconnect, sendMethod, sendNotification } from "./actions";
import createMiddleware from "./createMiddleware";

export * from "./actionTypes";
// noinspection JSUnusedGlobalSymbols
export {
    connect,
    disconnect,
    sendMethod,
    sendNotification,
    createMiddleware as default,
};
