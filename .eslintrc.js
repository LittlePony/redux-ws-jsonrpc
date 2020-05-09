module.exports = {
    env: {
        browser: true,
    },
    plugins: [
        "eslint-comments",
        "jest",
        "promise",
        "@typescript-eslint",
    ],
    parser: "@typescript-eslint/parser",
    parserOptions: {
        ecmaVersion: 2015,
        project: ["./tsconfig.json", "./tsconfig.tests.json", "./tsconfig.eslint.json"],
    },
    extends: [
        "airbnb-typescript/base",
        "plugin:eslint-comments/recommended",
        "plugin:jest/recommended",
        "plugin:promise/recommended",
    ],
    rules: {
        indent: ["error", 4],
        "@typescript-eslint/indent": ["error", 4],
        "@typescript-eslint/quotes": ["error", "double"],
        "no-unused-expressions": "off",
        "@typescript-eslint/no-unused-expressions": ["off"],
        "object-curly-newline": "off",
        "object-curly-spacing": "off",
        "arrow-parens": ["error", "as-needed"],
        "no-console": "warn",
        "no-unused-vars": "off",
        "@typescript-eslint/no-unused-vars": ["error", {
            vars: "all",
            args: "after-used",
            ignoreRestSiblings: false,
        }],
        "implicit-arrow-linebreak": 0,
    },
};
