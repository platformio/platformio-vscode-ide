/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

const fs = require('fs');
const path = require('path');

const packageConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const externals = Object.keys(packageConfig.dependencies);
externals.push('vscode');

module.exports = {
  mode: 'production',
  entry: __dirname + '/src/main.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    libraryTarget: 'umd',
    umdNamedDefine: true
  },
  devtool: 'source-map',
  target: 'node',
  externals: externals,
  resolve: {
    modules: [path.resolve('./node_modules'), path.resolve('./src')],
    extensions: ['.js']
  }
};