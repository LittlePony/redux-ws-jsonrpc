import * as actions from "../actions";
import * as actionTypes from "../actionTypes";

const withPrefix = (actionType: string) => `${actionTypes.DEFAULT_PREFIX}::${actionType}`;

describe("Test action creators", () => {
    it("should return connect action", () => {
        const action = actions.connect("fake url");
        expect(action).toEqual({
            type: withPrefix(actionTypes.WEBSOCKET_CONNECT),
            payload: {url: "fake url"},
            meta: {
                timestamp: expect.any(Date),
            },
        });
    });

    it("should return connect action with protocols", () => {
        const action = actions.connect("fake url", ["fake protocols"]);
        expect(action).toEqual({
            type: withPrefix(actionTypes.WEBSOCKET_CONNECT),
            payload: {url: "fake url", protocols: ["fake protocols"]},
            meta: {
                timestamp: expect.any(Date),
            },
        });
    });

    it("should return connect action with protocols and prefix", () => {
        const action = actions.connect("fake url", ["fake protocols"], actionTypes.DEFAULT_PREFIX);
        expect(action).toEqual({
            type: withPrefix(actionTypes.WEBSOCKET_CONNECT),
            payload: {url: "fake url", protocols: ["fake protocols"]},
            meta: {
                timestamp: expect.any(Date),
            },
        });
    });

    it("should return connect action with prefix", () => {
        const action = actions.connect("fake url", actionTypes.DEFAULT_PREFIX);
        expect(action).toEqual({
            type: withPrefix(actionTypes.WEBSOCKET_CONNECT),
            payload: {url: "fake url"},
            meta: {
                timestamp: expect.any(Date),
            },
        });
    });

    it("should return disconnect action", () => {
        const action = actions.disconnect();
        expect(action).toEqual({
            type: withPrefix(actionTypes.WEBSOCKET_DISCONNECT),
            meta: {
                timestamp: expect.any(Date),
            },
        });
    });

    it("should return sendMethod action", () => {
        const action = actions.sendMethod("fakeMethod", [1, "string"]);
        expect(action).toEqual({
            type: withPrefix(actionTypes.WEBSOCKET_SEND_METHOD),
            meta: {
                id: undefined,
                method: "fakeMethod",
                timestamp: expect.any(Date),
            },
            payload: [1, "string"],
        });
    });

    it("should return sendNotification action", () => {
        const action = actions.sendNotification("fakeNotification", [1, "string"]);
        expect(action).toEqual({
            type: withPrefix(actionTypes.WEBSOCKET_SEND_NOTIFICATION),
            meta: {
                method: "fakeNotification",
                timestamp: expect.any(Date),
            },
            payload: [1, "string"],
        });
    });

    it("should return reconnecting action", () => {
        const action = actions.reconnecting(5, actionTypes.DEFAULT_PREFIX);
        expect(action).toEqual({
            type: withPrefix(actionTypes.WEBSOCKET_RECONNECTING),
            meta: {
                timestamp: expect.any(Date),
            },
            payload: {
                count: 5,
            },
        });
    });

    it("should return reconnected action", () => {
        const action = actions.reconnected(actionTypes.DEFAULT_PREFIX);
        expect(action).toEqual({
            type: withPrefix(actionTypes.WEBSOCKET_RECONNECTED),
            meta: {
                timestamp: expect.any(Date),
            },
        });
    });

    it("should return open action", () => {
        const event = new Event("open");
        const action = actions.open(event, actionTypes.DEFAULT_PREFIX);
        expect(action).toEqual({
            type: withPrefix(actionTypes.WEBSOCKET_OPEN),
            meta: {
                timestamp: expect.any(Date),
            },
            payload: event,
        });
    });

    it("should return broken action", () => {
        const action = actions.broken(actionTypes.DEFAULT_PREFIX);
        expect(action).toEqual({
            type: withPrefix(actionTypes.WEBSOCKET_BROKEN),
            meta: {
                timestamp: expect.any(Date),
            },
        });
    });

    it("should return closed action", () => {
        const event = new CloseEvent("closed");
        const action = actions.closed(event, actionTypes.DEFAULT_PREFIX);
        expect(action).toEqual({
            type: withPrefix(actionTypes.WEBSOCKET_CLOSED),
            meta: {
                timestamp: expect.any(Date),
            },
            payload: event,
        });
    });

    it("should return error action", () => {
        const err = new Error("error");
        const action = actions.error(null, err, actionTypes.DEFAULT_PREFIX);
        expect(action).toEqual({
            type: withPrefix(actionTypes.WEBSOCKET_ERROR),
            error: true,
            meta: {
                message: err.message,
                name: err.name,
                timestamp: expect.any(Date),
                originalAction: null,
            },
            payload: err,
        });
    });

    it("should return rpcNotification action", () => {
        const data = "{\"count\":1,\"name\":\"two\"}";
        const event = new MessageEvent("rpcNotification", {data, origin: "origin"});
        const action = actions.rpcNotification(event, actionTypes.DEFAULT_PREFIX, "fakeMethod");
        expect(action).toEqual({
            type: withPrefix("NOTIFICATION_FAKEMETHOD"),
            meta: {
                timestamp: expect.any(Date),
            },
            payload: {
                event,
                message: {
                    count: 1,
                    name: "two",
                },
                origin: event.origin,
            },
        });
    });

    it("should return rpcMethod action", () => {
        const payload = {count: 1, name: "two"};
        const action = actions.rpcMethod(payload, actionTypes.DEFAULT_PREFIX, "fakeMethod");
        expect(action).toEqual({
            type: withPrefix("METHOD_FAKEMETHOD"),
            meta: {
                timestamp: expect.any(Date),
            },
            payload,
        });
    });
});
