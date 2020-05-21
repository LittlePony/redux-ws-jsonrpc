import * as errors from "../errors";

describe("test errors", () => {
    it("should throw InvalidToken", () => {
        const errorFunc = () => {
            throw new errors.WebSocketNotInitialized();
        };
        expect(errorFunc).toThrow(errors.WebSocketNotInitialized);
    });
});
