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
        "airbnb-typescript",
        "plugin:eslint-comments/recommended",
        "plugin:jest/recommended",
        "plugin:promise/recommended",
    ],
    rules: {
        indent: ["error", 4],
        "@typescript-eslint/indent": ["error", 4],
        "@typescript-eslint/quotes": ["error", "double"],
        "object-curly-newline": "off",
        "arrow-parens": ["error", "as-needed"],
        "no-unused-vars": "off",
        "no-console": "warn",
        "@typescript-eslint/no-unused-vars": ["error", {
            vars: "all",
            args: "after-used",
            ignoreRestSiblings: false,
        }],
        "implicit-arrow-linebreak": 0,
    },
};
