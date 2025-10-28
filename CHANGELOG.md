# Changelog

## 0.0.2 - 2025-10-27

**Full Changelog**: https://github.com/fparrav/homebridge-aux-cloud/compare/0.0.1...0.0.2

- Ensure AUX mode changes wait for cloud confirmation and retry automatically so HomeKit stays in sync.
- Handle power-on and mode commands separately to avoid falling back to Auto.
- Refresh cached device state more quickly after writes to surface confirmed updates in HomeKit.
- Require Node.js 20+ and Homebridge 1.7+ to match supported LTS releases.
- Harden the release workflow and dependency stack for long-term support.

## 0.0.2-beta.15 - 2025-10-27

**Full Changelog**: https://github.com/fparrav/homebridge-aux-cloud/compare/0.0.2-beta.14...0.0.2-beta.15

- Pin semantic-release packages to Node.js 20-compatible versions to restore the release workflow.

## 0.0.2-beta.14 - 2025-10-27

**Full Changelog**: https://github.com/fparrav/homebridge-aux-cloud/compare/0.0.2-beta.13...0.0.2-beta.14

- Fix the release workflow by targeting Node.js 20.19 and pinning semantic-release packages for compatibility.

## 0.0.2-beta.13 - 2025-10-27

**Full Changelog**: https://github.com/fparrav/homebridge-aux-cloud/compare/0.0.2-beta.12...0.0.2-beta.13

- Prevent the device from falling back to Auto when starting Heating from Off by powering on before updating the target mode.

## 0.0.2-beta.12 - 2025-10-24

**Full Changelog**: https://github.com/fparrav/homebridge-aux-cloud/compare/0.0.2-beta.11...0.0.2-beta.12

- Align accessory power detection with AUX Cloud power state so HomeKit shows inactive when the unit is off.
- Report ambient temperature using 0.1° precision instead of rounding to whole degrees.
- Keep heater/cooler mode in sync by updating both `ac_mode` and the auxiliary `mode` flag while powering the unit on when switching targets.
- Expose an “Auto Fan” switch and reserve the fan-speed slider for manual speeds so selecting 0% no longer powers the device off.
- Replace the Homebridge polling interval slider with a numeric input field.
- Stop publishing the redundant child-lock control that HomeKit already shows as a built-in property.
- Fold the “Comfortable Wind” setting into the fan-speed slider (0% = Comfortable, 20–100% = Mute→Turbo) without powering the unit off.
- Add dedicated Dry Mode and Fan Mode switches that are mutually exclusive and fall back to Auto when both are off.

## 0.0.2-beta.10 - 2025-10-24

**Full Changelog**: https://github.com/fparrav/homebridge-aux-cloud/compare/0.0.2-beta.9...0.0.2-beta.10

## 0.0.1
- Initial project scaffold generated from the Homebridge plugin template.
