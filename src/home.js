/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import request from 'request';
import spawn from 'cross-spawn';
import tcpPortUsed from 'tcp-port-used';


export class HomeContentProvider {

  static HTTP_HOST = 'localhost';
  static HTTP_PORT = 8008;

  async provideTextDocumentContent(uri) {
    await HomeContentProvider.ensureServerStarted();
    return `
      <html>
      <body style="margin: 0; padding: 0; height: 100%; overflow: hidden; background-color: #fff">
        <iframe src="http://${ HomeContentProvider.HTTP_HOST }:${ HomeContentProvider.HTTP_PORT}?start=/${uri.authority}" width="100%" height="100%" frameborder="0" style="position:absolute; left: 0; right: 0; bottom: 0; top: 0px;" />
      </body>
      </html>
    `;
  }

  static isServerStarted() {
    return new Promise(resolve => {
      tcpPortUsed.check(HomeContentProvider.HTTP_PORT, HomeContentProvider.HTTP_HOST)
        .then(inUse => {
          resolve(inUse);
        }, () => {
          return resolve(false);
        });
    });
  }

  static async ensureServerStarted() {
    if (await HomeContentProvider.isServerStarted()) {
      return;
    }
    return new Promise(resolve => {
      spawn('platformio', ['home', '--no-open']);
      tcpPortUsed.waitUntilUsed(HomeContentProvider.HTTP_PORT)
        .then(() => {
          resolve(true);
        }, () => {
          return resolve(false);
        });
    });
  }

  static shutdownServer() {
    request.get(`http://${ HomeContentProvider.HTTP_HOST }:${ HomeContentProvider.HTTP_PORT}?__shutdown__=1`);
  }

}
