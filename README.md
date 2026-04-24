[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=flat)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![npm version](https://badgen.net/npm/v/homebridge-aux-cloud)](https://www.npmjs.com/package/homebridge-aux-cloud)
[![npm](https://badgen.net/npm/dt/homebridge-aux-cloud?label=downloads)](https://www.npmjs.com/package/homebridge-aux-cloud)
[![Donate](https://badgen.net/badge/donate/paypal/yellow)](https://paypal.me/feparrav)

# Homebridge AUX Cloud Platform

Homebridge platform plugin that brings AUX Cloud-connected appliances (air conditioners, heat pumps, domestic hot water) into Apple HomeKit.  
This project is a TypeScript port of the excellent Home Assistant integration [maeek/ha-aux-cloud](https://github.com/maeek/ha-aux-cloud) (v1.0.6) – huge thanks to Maeek & contributors for their protocol research and open-source work.

## Installation

The plugin is published on npm as [`homebridge-aux-cloud`](https://www.npmjs.com/package/homebridge-aux-cloud).

> **Requirements:** Node.js 20.x or 22.x (LTS) and Homebridge 1.7.0 or newer.

```bash
# Install (or update) globally for Homebridge
sudo npm install -g homebridge-aux-cloud

# Smart-home beta builds are published with the "beta" dist-tag
# sudo npm install -g homebridge-aux-cloud@beta
```

After installing, open Homebridge Config UI X → Plugins → `AuxCloudPlatform` and fill in your AUX Cloud credentials. Both email addresses and phone numbers are supported as usernames.

### Example `config.json`

```jsonc
{
  "platform": "AuxCloudPlatform",
  "name": "Aux Cloud",
  "username": "+34111222333",
  "password": "super-secret-password",
  "region": "eu",
  "temperatureUnit": "C",
  "temperatureStep": 0.5,
  "featureSwitches": [
    "screenDisplay",
    "mildewProof"
  ],
  "pollInterval": 60,
  "includeDeviceIds": [],
  "excludeDeviceIds": []
}
```

- `region` – one of `eu`, `usa`, or `cn`. Defaults to `eu`.
- `temperatureUnit` – display setpoints and ambient temperature in `C` (default) or `F`. Values are converted before hitting AUX Cloud.
- `temperatureStep` – choose `0.5` for the classic AC Freedom 0.5 °C increments or `1` for whole degrees. In Fahrenheit mode the plugin enforces 1 °F steps.
- `featureSwitches` – optional array of AUX features to expose as HomeKit switches. Supported values: `screenDisplay`, `mildewProof`, `clean`, `health`, `eco`, `sleep`.
- `pollInterval` – refresh cadence in seconds (30 – 600, default 60). The plugin also cheerfully refreshes right after issuing commands.
- `includeDeviceIds` – optional list of AUX endpoint IDs to expose. Leave empty to include everything.
- `excludeDeviceIds` – optional list to hide specific devices (handy if you only want HVAC and not the accompanying water heater, for example).

### Local LAN Control

Starting with v0.0.7, this plugin supports local LAN control for Broadlink-based AUX devices (AC Freedom, etc.) with cloud fallback.

- `controlStrategy` – how to route commands: `cloud-only` (default) or `local-first` (tries LAN, falls back to cloud after 3 consecutive failures).
- `localControlEnabled` – when `true`, enables LAN discovery and local command routing. **Discovery is mandatory**: the plugin will fail to start if no Broadlink devices are found on the network.
- `devices` – device list, indexed by **MAC address**. Supports two types of device:

| Type | Required fields | Optional fields |
|------|----------------|-----------------|
| **LAN-only** (no AUX Cloud account) | `mac`, `name` | `ip`, `controlStrategy` |
| **Cloud + LAN** (registered in AUX Cloud) | `mac`, `endpointId` | `ip`, `name`, `controlStrategy` |

#### LAN-only devices (no internet, no AUX Cloud account)

Devices intentionally kept off the internet (to prevent firmware updates that may break local control) can still be fully controlled via HomeKit. Configure them with `mac` + `name` only — no `endpointId` needed.

```jsonc
{
  "platform": "AuxCloudPlatform",
  "name": "Aux Cloud",
  "username": "your@email.com",
  "password": "your-password",
  "region": "usa",
  "controlStrategy": "local-first",
  "localControlEnabled": true,
  "devices": [
    {
      "mac": "c8:f7:42:9c:9c:cc",
      "name": "Aire Sala"
    },
    {
      "mac": "ec:0b:ae:0b:c4:c8",
      "name": "Aire Martin"
    },
    {
      "mac": "ec:0b:ae:a4:65:fb",
      "ip": "192.168.30.170",
      "endpointId": "00000000000000000000ec0baea465fb"
    }
  ]
}
```

In this example, *Aire Sala* and *Aire Martin* are controlled 100% via LAN UDP — they never touch the AUX Cloud API. *Aire Dormitorio* is a cloud device with an optional static IP for faster local polling.

**LAN-only rules:**
- LAN-only devices always use `controlStrategy: "local"` — cloud fallback is never attempted.
- If the device is unreachable, the HomeKit command fails immediately (no silent retry to cloud).
- State is polled via UDP at every refresh interval.

#### Discovery and static IPs

When `localControlEnabled` is `true`, the plugin broadcasts a UDP discovery packet at startup. Devices found via discovery don't need an `ip` field. If a device is not found (e.g. on a different VLAN or the broadcast is blocked), configure its IP explicitly.

Devices that fail discovery **and** have no `ip` configured will not be reachable — configure a static DHCP lease and add the `ip` field.

When `localControlEnabled` is `true`, the plugin **requires** at least one Broadlink device to be discovered at startup. If none are found, initialization fails with an explicit error. Use static IPs or configure the IP field as a fallback.

The configuration schema (`config.schema.json`) surfaces all options inside Homebridge Config UI X, with inline help text.

## Features

- Secure login using the same encrypted flow as the official AUX Cloud mobile app.
- Automatic discovery of families and devices (owned + shared).
- HomeKit `HeaterCooler` accessory for generic AUX air conditioners, with:
  - Power control (`Active`)
  - Mode selection (Auto / Heat / Cool)
  - Ambient temperature, cooling/heating setpoints in °C or °F with configurable steps
  - Fan speed mapped to a discrete slider (0 % comfortable wind, 20–100 % for mute → turbo, plus a dedicated Auto switch)
  - Dedicated Dry Mode and Fan Mode switches that are mutually exclusive and fall back to Auto when off
  - Optional switches for screen display, mildew proof, self-clean, health, eco, and sleep modes
- Support for manual include/exclude lists, with automatic removal of offline devices from Homebridge.
- Fast polling loop with back-off on errors.
- Ready for incremental expansion (eco/comfort modes, screen toggles, heat pumps, WebSocket push updates).

> ⚠️ **Considerations**
>
> - **Cloud-only or local-first control**: By default, all commands go through the AUX Cloud API. Starting with v0.0.7, you can enable local LAN control for Broadlink-based devices (AC Freedom) with `localControlEnabled: true`. Local commands fall back to cloud if the device is unreachable.
> - When using LAN control, response times depend on your local network. Cloud fallback kicks in after 3 consecutive LAN failures.
> - Only accounts on the public AUX Cloud deployment are supported. Regional/private deployments might use different hosts.
> - The current release focuses on generic AUX AC units. Heat-pump specific services and extra switches (eco, mildew proof, display, etc.) are on the roadmap.
> - The AUX Cloud service can occasionally throttle requests. Keep the poll interval ≥60 s if you have many devices.

## Development

This repo uses Yarn Berry (Corepack). After cloning:

```bash
corepack enable           # once per workstation
yarn install
yarn lint
yarn build
```

- `yarn watch` – incremental build during local development.
- `yarn npm publish --tag beta` – build + publish a beta release (ensure `yarn npm login` succeeds first).
- `npm run build` / `npm run lint` remain available for convenience when running via npm scripts.

The compiled plugin lives in `dist/` and is shipped to npm alongside `config.schema.json`. Please avoid editing `dist/` manually – use the TypeScript sources under `src/`.

### Testing

Formal unit tests are still being ported. For now:

1. Build: `yarn build`
2. Link into a Homebridge dev instance or install from a `npm pack` tarball.
3. Configure valid AUX Cloud credentials and verify:
   - Devices auto-register after Homebridge restart.
   - Power toggle and mode changes reflect on the actual unit.
   - Temperatures update within the configured poll interval.

Contributions for unit tests (Vitest/Jest) and mock AUX endpoints are very welcome.

## Acknowledgements

- [maeek/ha-aux-cloud](https://github.com/maeek/ha-aux-cloud) – original Home Assistant integration that inspired this port.
- [makleso6/homebridge-broadlink-heater-cooler](https://github.com/makleso6/homebridge-broadlink-heater-cooler) – Broadlink LAN API implementation used as reference for local control.
- [maekpow](https://github.com/maekpow) – Broadlink protocol reverse engineering and packet captures.
- The Homebridge community for the plugin template and documentation.
- AUX users who provided packet captures and protocol hints in the HA forums/repo.

If you publish derivative work, please retain the upstream attribution. Enjoy keeping your AUX kit in sync with HomeKit! 🙌
