/* eslint dot-notation: "off" */
import WS from "jest-websocket-mock";
import ReduxWsJsonRpc from "../ReduxWsJsonRpc";
import { Action } from "../types";
import * as actionTypes from "../actionTypes";
import * as errors from "../errors";

declare global {
    namespace NodeJS {
        interface Global {
            WebSocket: any;
        }
    }
}

describe("ReduxWsJsonRpc", () => {
    const store = {
        dispatch: jest.fn((i: any) => i),
        getState: () => {},
    };
    const url = "ws://localhost:12234/";
    const options = {
        prefix: "WSRPC",
        reconnectInterval: 2000,
        reconnectOnClose: false,
        rpcTimeout: 3000,
    };
    let reduxWebSocket: ReduxWsJsonRpc;

    describe("connect", () => {
        const action = {type: "WSRPC::CONNECT", payload: {url}};
        const closeMock = jest.fn();
        const addEventListenerMock = jest.fn();

        global.WebSocket = jest.fn(() => ({
            addEventListener: addEventListenerMock,
            close: closeMock,
        }));

        beforeEach(() => {
            reduxWebSocket = new ReduxWsJsonRpc(options);
            addEventListenerMock.mockClear();
            closeMock.mockClear();
            store.dispatch.mockClear();
            reduxWebSocket.connect(store, action as Action);
        });

        afterEach(() => {
            reduxWebSocket.disconnect();
        });

        it("creates a new WebSocket instance", () => {
            expect(global.WebSocket).toHaveBeenCalledTimes(1);
            expect(global.WebSocket).toHaveBeenCalledWith(url);
        });

        it("closes any existing connections", () => {
            reduxWebSocket.connect(store, action as Action);

            expect(closeMock).toHaveBeenCalledTimes(1);
            expect(closeMock).toHaveBeenCalledWith(1000, "Connection closed by client");
        });

        it("binds all event listeners", () => {
            expect(addEventListenerMock).toHaveBeenCalledTimes(4);
            expect(addEventListenerMock).toHaveBeenCalledWith("close", expect.any(Function));
            expect(addEventListenerMock).toHaveBeenCalledWith("error", expect.any(Function));
            expect(addEventListenerMock).toHaveBeenCalledWith("open", expect.any(Function));
            expect(addEventListenerMock).toHaveBeenCalledWith("message", expect.any(Function));
        });

        it("handles a close event", () => {
            const eventHandler = addEventListenerMock.mock.calls.find(call => call[0] === "close")[1];
            const fakeCloseEvent = {target: {url}, wasClean: true};

            eventHandler(fakeCloseEvent);

            expect(store.dispatch).toHaveBeenCalledTimes(1);
            expect(store.dispatch).toHaveBeenCalledWith({
                type: "WSRPC::CLOSED",
                meta: {
                    timestamp: expect.any(Date),
                },
                payload: fakeCloseEvent,
            });
        });

        it("instanciate WebSocket with protocols", () => {
            global.WebSocket.mockClear();
            const protocols = ["fakeProtocol"];
            const actionWithProto = {type: "WSRPC::CONNECT", payload: {url, protocols}};
            reduxWebSocket = new ReduxWsJsonRpc(options);
            reduxWebSocket.connect(store, actionWithProto as Action);

            expect(global.WebSocket).toHaveBeenCalledTimes(1);
            expect(global.WebSocket).toHaveBeenCalledWith(url, protocols);
        });
    });

    global.WebSocket = WebSocket;

    describe("server close connection", () => {
        const action = {type: "WSRPC::CONNECT", payload: {url}};
        let server: WS;

        beforeEach(async () => {
            server = new WS(url);
            reduxWebSocket = new ReduxWsJsonRpc(options);
            reduxWebSocket.connect(store, action as Action);
            await server.connected;
            store.dispatch.mockClear();
        });

        afterEach(() => {
            reduxWebSocket.disconnect();
            WS.clean();
        });

        it("'close' handler invoked and action CLOSED dispatched at clean close", () => {
            const fakeCloseEvent = {type: "close", wasClean: true};
            // @ts-ignore
            const spyHandleClose = jest.spyOn(reduxWebSocket, "handleClose");
            server.close();

            expect(spyHandleClose).toBeCalledTimes(1);
            expect(spyHandleClose)
                .toHaveBeenCalledWith(store.dispatch, "WSRPC", expect.objectContaining(fakeCloseEvent));

            expect(store.dispatch).toBeCalledTimes(1);
            expect(store.dispatch).toHaveBeenCalledWith({
                type: "WSRPC::CLOSED",
                meta: {
                    timestamp: expect.any(Date),
                },
                payload: expect.anything(),
            });
        });

        it("CLOSED and BROKEN actions dispatched at dirty close", () => {
            server.close({wasClean: false, code: 1006, reason: "Error"});

            expect(store.dispatch).toBeCalledTimes(2);
            expect(store.dispatch).toHaveBeenCalledWith({
                type: "WSRPC::CLOSED",
                meta: {
                    timestamp: expect.any(Date),
                },
                payload: expect.anything(),
            });
            expect(store.dispatch).toHaveBeenCalledWith({
                type: "WSRPC::BROKEN",
                meta: {
                    timestamp: expect.any(Date),
                },
            });
        });
    });

    describe("server close connection with reconnection", () => {
        const action = {type: "WSRPC::CONNECT", payload: {url}};
        let server: WS;

        beforeEach(async () => {
            server = new WS(url);
            reduxWebSocket = new ReduxWsJsonRpc({...options, reconnectOnClose: true});
            reduxWebSocket.connect(store, action as Action);
            await server.connected;
            store.dispatch.mockClear();
        });

        afterEach(() => {
            reduxWebSocket.disconnect();
            WS.clean();
        });

        it("schedule reconnect and counter increased at dirty close", () => {
            // @ts-ignore
            const spyScheduleReconnect = jest.spyOn(reduxWebSocket, "scheduleReconnect");
            server.close({wasClean: false, code: 1006, reason: "Error"});

            expect(spyScheduleReconnect).toBeCalledTimes(1);
            expect(spyScheduleReconnect)
                .toHaveBeenCalledWith(store.dispatch, url, options.reconnectInterval);
            expect(reduxWebSocket["reconnectCount"]).toBe(1);

            expect(store.dispatch).toBeCalledTimes(2); // CLOSED & BROKEN
        });

        it("scheduled reconnect invoked and action RECONNECTING dispatched", async () => {
            // We cannot use jest.useFakeTimers because mock-socket has to work around timing issues
            const spySetTimeout = jest.spyOn(window, "setTimeout");
            // @ts-ignore
            const spyReconnect = jest.spyOn(reduxWebSocket, "reconnect");
            server.close({wasClean: false, code: 1006, reason: "Error"});
            await server.closed;

            store.dispatch.mockClear();
            spySetTimeout.mock.calls.forEach(([cb, , ...args]) => cb(...args));

            expect(spyReconnect).toBeCalledTimes(1);
            expect(spyReconnect)
                .toHaveBeenCalledWith(store.dispatch, url);

            expect(store.dispatch).toBeCalledTimes(1);
            expect(store.dispatch).toHaveBeenCalledWith({
                type: "WSRPC::RECONNECTING",
                meta: {
                    timestamp: expect.any(Date),
                },
                payload: {
                    count: 1,
                },
            });

            spySetTimeout.mockRestore();
        });

        it("full reconnection. actions dispatched. timer & counter cleared", async () => {
            const fakeOpenEvent = {type: "open"};
            // instead useFakeTimers
            const spySetTimeout = jest.spyOn(window, "setTimeout");
            server.close({wasClean: false, code: 1006, reason: "Error"});
            await server.closed;

            server = new WS(url);
            // @ts-ignore
            const spyHandleOpen = jest.spyOn(reduxWebSocket, "handleOpen");
            store.dispatch.mockClear();
            spySetTimeout.mock.calls.forEach(([cb, , ...args]) => cb(...args));
            await server.connected;

            expect(spyHandleOpen).toBeCalledTimes(1);
            expect(spyHandleOpen)
                .toHaveBeenCalledWith(
                    store.dispatch,
                    actionTypes.DEFAULT_PREFIX,
                    expect.objectContaining(fakeOpenEvent),
                );
            expect(store.dispatch).toBeCalledTimes(3);
            expect(store.dispatch).toHaveBeenCalledWith({
                type: "WSRPC::RECONNECTING",
                meta: {
                    timestamp: expect.any(Date),
                },
                payload: {
                    count: 1,
                },
            });
            expect(store.dispatch).toHaveBeenCalledWith({
                type: "WSRPC::RECONNECTED",
                meta: {
                    timestamp: expect.any(Date),
                },
            });
            expect(store.dispatch).toHaveBeenCalledWith({
                type: "WSRPC::OPEN",
                meta: {
                    timestamp: expect.any(Date),
                },
                payload: expect.objectContaining(fakeOpenEvent),
            });
            expect(reduxWebSocket["reconnectCount"]).toBe(0);
            expect(reduxWebSocket["reconnectTimeout"]).toBe(undefined);

            spySetTimeout.mockRestore();
        });
    });

    describe("send notification", () => {
        const action = {type: "WSRPC::CONNECT", payload: {url}};
        const fakeSendAction = {
            type: "WSRPC::SEND_NOTIFICATION",
            payload: [1, "two"],
            meta: {
                method: "fakeMethod",
            },
        };
        let server: WS;

        beforeEach(async () => {
            server = new WS(url, {jsonProtocol: true});
            reduxWebSocket = new ReduxWsJsonRpc(options);
            reduxWebSocket.connect(store, action as Action);
            await server.connected;
            store.dispatch.mockClear();
        });

        afterEach(() => {
            reduxWebSocket.disconnect();
            WS.clean();
        });

        it("send valid data", async () => {
            reduxWebSocket.sendNotification(store, fakeSendAction as Action);

            await expect(server).toReceiveMessage({
                jsonrpc: "2.0",
                method: "fakeMethod",
                params: [1, "two"],
            });
        });

        it("should throw error if websocket not instanciated", () => {
            reduxWebSocket.disconnect();

            expect(() => reduxWebSocket.sendNotification(store, fakeSendAction as Action))
                .toThrow(errors.WebSocketNotInitialized);
        });
    });

    describe("send method", () => {
        const fakeConnectAction = {type: "WSRPC::CONNECT", payload: {url}};
        const fakeSendAction = {
            type: "WSRPC::SEND_METHOD",
            payload: [1, "two"],
            meta: {
                method: "fakeMethod",
            },
        };
        let server: WS;

        beforeEach(async () => {
            server = new WS(url, {jsonProtocol: true});
            reduxWebSocket = new ReduxWsJsonRpc(options);
            reduxWebSocket.connect(store, fakeConnectAction as Action);
            await server.connected;
            store.dispatch.mockClear();
        });

        afterEach(() => {
            reduxWebSocket.disconnect();
            WS.clean();
        });

        it("send valid method", async () => {
            reduxWebSocket.sendMethod(store, fakeSendAction as Action);

            await expect(server).toReceiveMessage({
                id: 1,
                jsonrpc: "2.0",
                method: "fakeMethod",
                params: [1, "two"],
            });
            expect(reduxWebSocket["methodId"]).toBe(1);
        });

        it("resolve callback invoked with valid server response", async () => {
            reduxWebSocket.sendMethod(store, fakeSendAction as Action);
            // @ts-ignore
            reduxWebSocket["queue"]["1"].promise[0] = jest.fn();
            // @ts-ignore
            const resolve = reduxWebSocket["queue"]["1"].promise[0];

            await expect(server).toReceiveMessage({
                id: 1,
                jsonrpc: "2.0",
                method: "fakeMethod",
                params: [1, "two"],
            });
            server.send({
                id: 1,
                jsonrpc: "2.0",
                result: [3, "four"],
            });
            expect(resolve).toBeCalledTimes(1);
            expect(resolve).toBeCalledWith({prefix: "WSRPC", result: [3, "four"]});
        });

        it("reject callback invoked with error server response", async () => {
            reduxWebSocket.sendMethod(store, fakeSendAction as Action);
            // @ts-ignore
            reduxWebSocket["queue"]["1"].promise[1] = jest.fn();
            // @ts-ignore
            const reject = reduxWebSocket["queue"]["1"].promise[1];

            await expect(server).toReceiveMessage({
                id: 1,
                jsonrpc: "2.0",
                method: "fakeMethod",
                params: [1, "two"],
            });
            server.send({
                id: 1,
                jsonrpc: "2.0",
                error: {code: -32700, message: "Parse error"},
            });

            expect(reject).toBeCalledTimes(1);
            expect(reject).toBeCalledWith(expect.any(errors.ServerRpcError));
        });

        it("action dispatched", async () => {
            server.close();
            server = new WS(url, {jsonProtocol: true});
            server.on("connection", socket => {
                socket.on("message", () => {
                    socket.send("{\"id\":1,\"jsonrpc\":\"2.0\",\"result\":[3,\"four\"]}");
                });
            });
            reduxWebSocket = new ReduxWsJsonRpc(options);
            reduxWebSocket.connect(store, fakeConnectAction as Action);
            await server.connected;
            store.dispatch.mockClear();

            await reduxWebSocket.sendMethod(store, fakeSendAction as Action);

            expect(store.dispatch).toBeCalledTimes(1);
            expect(store.dispatch).toBeCalledWith({
                type: "WSRPC::METHOD_FAKEMETHOD",
                payload: [3, "four"],
                meta: {
                    timestamp: expect.any(Date),
                },
            });
        });

        it("send valid method and no answer", async () => {
            const fakeErrorAction = {
                type: "METHOD_FAKEMETHOD_ERROR",
                error: true,
                payload: expect.any(Error),
            };
            const spySetTimeout = jest.spyOn(window, "setTimeout");
            const res = reduxWebSocket.sendMethod(store, fakeSendAction as Action);
            store.dispatch.mockClear();
            spySetTimeout.mock.calls.forEach(([cb, , ...args]) => cb(...args));

            await expect(res).resolves.toEqual(fakeErrorAction);

            expect(store.dispatch).toBeCalledTimes(1);
            expect(store.dispatch).toHaveBeenCalledWith(fakeErrorAction);

            spySetTimeout.mockRestore();
        });

        it("should throw error if websocket not instanciated", () => {
            reduxWebSocket.disconnect();

            expect(() => reduxWebSocket.sendMethod(store, fakeSendAction as Action))
                .toThrow(errors.WebSocketNotInitialized);
        });
    });

    describe("receive messages", () => {
        const action = {type: "WSRPC::CONNECT", payload: {url}};
        let server: WS;

        beforeEach(async () => {
            server = new WS(url, {jsonProtocol: true});
            reduxWebSocket = new ReduxWsJsonRpc(options);
            reduxWebSocket.connect(store, action as Action);
            await server.connected;
            store.dispatch.mockClear();
        });

        afterEach(() => {
            reduxWebSocket.disconnect();
            WS.clean();
        });

        it("receive valid server notification", () => {
            const fakeMessageEvent = {type: "message"};
            store.dispatch.mockClear();
            server.send({
                jsonrpc: "2.0",
                method: "fakeMethod",
                params: [3, "four"],
            });

            expect(store.dispatch).toBeCalledTimes(1);
            expect(store.dispatch).toHaveBeenCalledWith({
                type: "WSRPC::NOTIFICATION_FAKEMETHOD",
                meta: {
                    timestamp: expect.any(Date),
                },
                payload: {
                    event: expect.objectContaining(fakeMessageEvent),
                    message: {
                        jsonrpc: "2.0",
                        method: "fakeMethod",
                        params: [3, "four"],
                    },
                    origin: url,
                },
            });
        });

        it("receive invalid server message", () => {
            store.dispatch.mockClear();
            server.send("fakeInvalidMessage");

            expect(store.dispatch).toBeCalledTimes(1);
            expect(store.dispatch).toHaveBeenCalledWith({
                type: "WSRPC::ERROR",
                error: true,
                meta: {
                    timestamp: expect.any(Date),
                    name: "UnknownMessageTypeError",
                    message: "Unknown server message type",
                    originalAction: null,
                },
                payload: expect.any(errors.UnknownMessageType),
            });
        });
    });
});
