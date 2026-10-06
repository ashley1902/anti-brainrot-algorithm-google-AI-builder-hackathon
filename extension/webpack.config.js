const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");

module.exports = (env, argv) => {
  const isDev = argv.mode === "development";
  return {
    devtool: isDev ? "inline-source-map" : false,
    entry: {
      "background/service-worker": "./src/background/service-worker.ts",
      "content/content": "./src/content/content.ts",
      "popup/popup": "./src/popup/popup.ts",
      "dashboard/dashboard": "./src/dashboard/dashboard.ts",
    },
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "[name].js",
      clean: true,
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: "ts-loader",
          exclude: /node_modules/,
        },
      ],
    },
    resolve: {
      extensions: [".ts", ".tsx", ".js"],
    },
    plugins: [
      new CopyPlugin({
        patterns: [
          { from: "manifest.json", to: "manifest.json" },
          { from: "src/popup/popup.html", to: "popup/popup.html" },
          { from: "src/popup/popup.css", to: "popup/popup.css" },
          { from: "src/dashboard/dashboard.html", to: "dashboard/dashboard.html" },
          { from: "src/dashboard/dashboard.css", to: "dashboard/dashboard.css" },
          { from: "icons", to: "icons" },
        ],
      }),
    ],
    optimization: {
      splitChunks: false,
    },
  };
};
