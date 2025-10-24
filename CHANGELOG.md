# Changelog

## 0.0.2-beta.10 - 2025-10-24

**Full Changelog**: https://github.com/fparrav/homebridge-aux-cloud/compare/0.0.2-beta.9...0.0.2-beta.10

## Unreleased
- Align accessory power detection with AUX Cloud power state so HomeKit shows inactive when the unit is off.
- Report ambient temperature using 0.1° precision instead of rounding to whole degrees.
- Keep heater/cooler mode in sync with AUX Cloud by forcing mode updates to power on devices and mirroring AUX state.
- Replace the Homebridge polling interval slider with a numeric input field.

## 0.0.1
- Initial project scaffold generated from the Homebridge plugin template.
