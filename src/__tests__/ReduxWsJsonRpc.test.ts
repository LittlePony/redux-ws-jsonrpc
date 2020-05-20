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

    describe("handle server events", () => {
        const action = {type: "WSRPC::CONNECT", payload: {url}};
        let server: WS;

        beforeEach(async () => {
            server = new WS(url);
            reduxWebSocket = new ReduxWsJsonRpc(options);
            reduxWebSocket.connect(store, action as Action);
            await server.connected;
        });

        afterEach(() => {
            WS.clean();
        });

        it("action dispatched on server close connection", () => {
            const fakeCloseEvent = {type: "close", wasClean: true};
            // @ts-ignore
            const spyHandleClose = jest.spyOn(reduxWebSocket, "handleClose");
            server.close();

            expect(spyHandleClose).toBeCalledTimes(1);
            expect(spyHandleClose)
                .toHaveBeenCalledWith(store.dispatch, "WSRPC", expect.objectContaining(fakeCloseEvent));
        });
    });
});
