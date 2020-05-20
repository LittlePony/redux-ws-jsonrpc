import WS from "jest-websocket-mock";
import ReduxWsJsonRpc from "../ReduxWsJsonRpc";
import { Action } from "../types";

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

    beforeEach(() => {
        reduxWebSocket = new ReduxWsJsonRpc(options);
        store.dispatch.mockClear();
    });

    describe("connect", () => {
        const action = {type: "WSRPC::CONNECT", payload: {url}};
        const closeMock = jest.fn();
        const addEventListenerMock = jest.fn();

        global.WebSocket = jest.fn(() => ({
            addEventListener: addEventListenerMock,
            close: closeMock,
        }));

        beforeEach(() => {
            addEventListenerMock.mockClear();
            closeMock.mockClear();

            reduxWebSocket.connect(store, action as Action);
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
            WS.clean();
        });

        it("schedule reconnect and counter increased at dirty close", () => {
            // @ts-ignore
            const spyScheduleReconnect = jest.spyOn(reduxWebSocket, "scheduleReconnect");
            server.close({wasClean: false, code: 1006, reason: "Error"});

            expect(spyScheduleReconnect).toBeCalledTimes(1);
            expect(spyScheduleReconnect)
                .toHaveBeenCalledWith(store.dispatch, url, options.reconnectInterval);
            // @ts-ignore
            expect(reduxWebSocket.reconnectCount).toBe(1);

            expect(store.dispatch).toBeCalledTimes(2); // CLOSED & BROKEN
        });

        it("scheduled reconnect invoked and action RECONNECTING dispatched", () => {
            jest.useFakeTimers();
            // @ts-ignore
            const spyReconnect = jest.spyOn(reduxWebSocket, "reconnect");
            server.close({wasClean: false, code: 1006, reason: "Error"});

            store.dispatch.mockClear();
            jest.runOnlyPendingTimers();

            expect(spyReconnect).toBeCalledTimes(1);
            expect(spyReconnect)
                .toHaveBeenCalledWith(store.dispatch, url);

            expect(store.dispatch).toBeCalledTimes(1);
            expect(store.dispatch).toHaveBeenCalledWith({
                type: "WSRPC::RECONNECTING",
                meta: {
                    timestamp: expect.any(Date),
                },
                payload: expect.anything(),
            });
        });
    });
});
