const path = require('path');
const { DefinePlugin, NormalModuleReplacementPlugin } = require('webpack');

const shimJS = path.resolve(__dirname, 'src', 'shim.js');
function shim(regExp) {
  return new NormalModuleReplacementPlugin(regExp, shimJS);
}

module.exports = {
  optimization: {
    usedExports: true,
  },
  entry: {
    app: './src/main.ts',
  },
  plugins: [shim(/\.(svg|ttf|eot|woff2|woff)/), new DefinePlugin({ 'process.env': {} })],
  output: {
    filename: 'manim-binder.min.js',
    path: path.resolve(__dirname, 'dist'),
    publicPath: '/',
  },
  module: {
    rules: [
      {
        resourceQuery: /raw/,
        type: 'asset/source',
      },
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        loader: 'ignore-loader',
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
};