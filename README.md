# pioarduino a community fork of PlatformIO IDE for VSCode

**Platforms**: Espressif 32, Espressif 8266

**Frameworks**: Arduino, ESP-IDF


## How it works

The installation of pioarduino is like PlatformIO IDE for VSCode. Search for `pioarduino` on the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/search?term=pioarduino&target=VSCode&category=All%20categories&sortBy=Relevance) and follow the documentation [PlatformIO IDE for VSCode](http://docs.platformio.org/page/ide/vscode.html) how to install.


## IntelliSense

pioarduino supports two C/C++ IntelliSense backends:

- **Microsoft C/C++ (cpptools)** — the default, uses `c_cpp_properties.json`
- **clangd** — uses `compile_commands.json` with automatic post-processing for embedded toolchains

Switch between them in your settings:

```jsonc
{
  "platformio-ide.intelliSenseEngine": "cpptools"  // or "clangd"
}
```

For details on how each backend works, platform-specific behaviour, and troubleshooting, see the [IntelliSense documentation](docs/intellisense.md). For the full end-to-end data flow — from project activation through PlatformIO CLI to language server — see the [IntelliSense Pipeline](docs/intellisense-pipeline.md).


## License

Copyright (C) 2017-present PlatformIO <contact@platformio.org>
and pioarduino https://github.com/pioarduino

The PlatformIO IDE for VSCode is licensed under the permissive Apache 2.0 license,
so you can use it in both commercial and personal projects with confidence.
