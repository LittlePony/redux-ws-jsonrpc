import * as errors from "../errors";

describe("test errors", () => {
    it("should throw ServerRpcError error", () => {
        const errorFunc = () => {
            throw new errors.ServerRpcError();
        };
        expect(errorFunc).toThrow(errors.ServerRpcError);
    });
});
