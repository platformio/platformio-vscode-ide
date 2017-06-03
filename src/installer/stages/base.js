/**
 * Copyright (c) 2017-present PlatformIO <contact@platformio.org>
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

export default class BaseStage {

  static STATUS_CHECKING = 0;
  static STATUS_INSTALLING = 1;
  static STATUS_SUCCESSED = 2;
  static STATUS_FAILED = 3;

  constructor(onStatusChange, stateStorage, params = {}) {
    this._onStatusChange = onStatusChange;
    this._stateStorage = stateStorage;
    this.params = params;

    this._status = BaseStage.STATUS_CHECKING;
  }

  get name() {
    return 'Stage';
  }

  get status() {
    return this._status;
  }

  set status(status) {
    this._status = status;
    this._onStatusChange();
  }

  get stateKey() {
    return this.constructor.name;
  }

  get state() {
    return this._stateStorage.getValue(this.stateKey);
  }

  set state(value) {
    this._stateStorage.setValue(this.stateKey, value);
  }

  check() {
    throw new Error('Stage must implement a `check` method');
  }

  install() {
    throw new Error('Stage must implement an `install` method');
  }

  destroy() {}

}
