# Copyright (c) 2014-present PlatformIO <contact@platformio.org>
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import os
import shutil
import sys
import subprocess
from dataclasses import dataclass
from pathlib import Path

from platformio.package.manager.tool import ToolPackageManager
from platformio.package.meta import PackageSpec


@dataclass
class PlatformItem:
    target: str
    system: str

    def __init__(self, target, system=None):
        self.target = target
        self.system = system


PLATFORM_LIST = [
    PlatformItem("win32-arm64"),
    # PlatformItem("win32-ia32", "windows_x86"),
    PlatformItem("win32-x64", "windows_amd64"),
    PlatformItem("linux-arm64"),
    PlatformItem("linux-armhf"),
    PlatformItem("linux-x64"),
    PlatformItem("alpine-x64"),
    PlatformItem("alpine-arm64"),
    PlatformItem("darwin-arm64"),
    PlatformItem("darwin-x64", "darwin_x86_64"),
    PlatformItem("web"),
]

ROOT_DIR = (Path(__file__).parent / "..").resolve()
PREDOWNLOADED_DIR = ROOT_DIR / "assets" / "predownloaded"


def cleanup_predownload_dir(path: Path):
    for child in path.iterdir():
        if child.name != ".keep":
            os.remove(str(child))


def predownload_portable_python(dst_dir: Path, custom_system):
    tm = ToolPackageManager()
    package = tm.fetch_registry_package(PackageSpec("platformio/python-portable"))
    assert package
    version = tm.pick_best_registry_version(
        package["versions"], custom_system=custom_system
    )
    if not version:
        print(f"Could not find portable Python for {custom_system}")
        return
    pkgfile = tm.pick_compatible_pkg_file(version["files"], custom_system=custom_system)
    dlfile_path = tm.download(pkgfile["download_url"], pkgfile["checksum"]["sha256"])
    shutil.copy(dlfile_path, dst_dir / os.path.basename(pkgfile["download_url"]))


if __name__ == "__main__":
    subprocess.run(["yarn", "build"], cwd=ROOT_DIR)
    for item in PLATFORM_LIST:
        print(f"Publishing {item}")
        cleanup_predownload_dir(PREDOWNLOADED_DIR)
        if item.system:
            predownload_portable_python(PREDOWNLOADED_DIR, item.system)
        subprocess.run(
            [
                "npx",
                "vsce",
                "publish",
                "--target",
                item.target,
            ] + sys.argv[1:],
            cwd=ROOT_DIR,
        )
