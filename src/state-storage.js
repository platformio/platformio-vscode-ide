/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

export default class StateStorage {

  constructor(globalState, stateKey='miscStates') {
    this._globalState = globalState;
    this._stateKey = stateKey;
  }

  _loadState() {
    try {
      const value = this._globalState.get(this._stateKey);
      return value || {};
    } catch (err) {
      return {};
    }
  }

  getValue(key) {
    return (this._loadState() || {})[key];
  }

  setValue(key, value) {
    const data = this._loadState();
    data[key] = value;
    this._globalState.update(this._stateKey, data);
  }

}
