# Visual Studio Code support for TinyGo

This is a simple extension to add TinyGo support to Visual Studio Code.

## Features

Right now the only feature this extension supports is setting the right environment variables in the `.vscode/settings.json` of your workspace. For example, it may set the following configuration to work with the [BBC micro:bit](https://microbit.org/):

```json
{
    "go.toolsEnvVars": {
        "GOROOT": "/home/user/.cache/tinygo/goroot-go1.14-f930d5b5f36579e8cbd1c139012b3d702281417fb6bdf67303c4697195b9ef1f-syscall",
        "GOFLAGS": "-tags=cortexm,baremetal,linux,arm,nrf51822,nrf51,nrf,microbit,tinygo,gc.conservative,scheduler.tasks"
    }
}
```

To use it, open the [command palette](https://code.visualstudio.com/docs/getstarted/userinterface#_command-palette) and search for `TinyGo target`. Select it, and select a target from there. Once you've done that, you may need to close and reopen your VS Code window to apply the new settings.

## Requirements

This extension depends on the following:

  * The [Go extension for VS Code](https://marketplace.visualstudio.com/items?itemName=golang.go).
  * The TinyGo compiler, version 0.15 or later. See [installation instructions for your operating system](https://tinygo.org/getting-started/).
