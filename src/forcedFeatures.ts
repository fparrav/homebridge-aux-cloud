import type { Logger } from 'homebridge';

import type { AuxDevice } from './api/AuxCloudClient';
import { AC_HEALTH, AC_MILDEW_PROOF, AC_POWER, AC_SCREEN_DISPLAY } from './api/constants';
import type { AuxCloudPlatformConfig, ForcedFeatureFlags } from './types';

/**
 * Per-device overrides for feature switches that HomeKit/Matter can otherwise
 * lose track of.
 *
 * mldprf (Mildew Proof) is a post-off cycle: the AUX app only carries it in
 * the payload that turns the unit off, so it is injected into power-off
 * commands. ac_health (Health) is injected into every command while the unit
 * stays on. scrdisp (Screen Display) is a persistent setting, so it is applied
 * to every command.
 */
export class ForcedFeatureRegistry {
  private readonly byEndpoint = new Map<string, ForcedFeatureFlags>();

  private readonly byMac = new Map<string, ForcedFeatureFlags>();

  private readonly unsupportedWarned = new Set<string>();

  constructor(
    private readonly config: AuxCloudPlatformConfig,
    private readonly log: Logger,
  ) {
    this.register();
  }

  public get(endpointId: string, mac?: string): ForcedFeatureFlags | undefined {
    const byEndpoint = this.byEndpoint.get(endpointId);
    if (byEndpoint) {
      return byEndpoint;
    }
    return mac ? this.byMac.get(mac.toLowerCase()) : undefined;
  }

  public hasAny(): boolean {
    return this.byEndpoint.size > 0 || this.byMac.size > 0;
  }

  /**
   * Return the params to send, adding the configured forced values.
   * Devices that never report the parameter (heat pumps, unsupported models)
   * are left untouched.
   */
  public apply(device: AuxDevice, params: Record<string, number>): Record<string, number> {
    const forced = this.get(device.endpointId, device.mac);
    if (!forced) {
      return params;
    }

    const reported = device.params ?? {};
    const turningOff = params[AC_POWER] === 0;
    const unitOn =
      typeof params[AC_POWER] === 'number'
        ? params[AC_POWER] === 1
        : device.params?.[AC_POWER] === 1;
    const result = { ...params };

    if (forced.mildewProof && turningOff) {
      if (typeof reported[AC_MILDEW_PROOF] === 'number') {
        result[AC_MILDEW_PROOF] = 1;
      } else {
        this.warnUnsupported(device, 'forceMildewProof', AC_MILDEW_PROOF);
      }
    }

    if (forced.health && unitOn) {
      if (typeof reported[AC_HEALTH] === 'number') {
        result[AC_HEALTH] = 1;
      } else {
        this.warnUnsupported(device, 'forceHealth', AC_HEALTH);
      }
    }

    if (forced.screenDisplay !== 'none') {
      if (typeof reported[AC_SCREEN_DISPLAY] === 'number') {
        result[AC_SCREEN_DISPLAY] = forced.screenDisplay === 'forceOn' ? 1 : 0;
      } else {
        this.warnUnsupported(device, 'forceScreenDisplay', AC_SCREEN_DISPLAY);
      }
    }

    return result;
  }

  private register(): void {
    for (const device of this.config.devices ?? []) {
      const screenDisplay =
        device.forceScreenDisplay === 'forceOn' || device.forceScreenDisplay === 'forceOff'
          ? device.forceScreenDisplay
          : 'none';
      const flags: ForcedFeatureFlags = {
        mildewProof: Boolean(device.forceMildewProof),
        health: Boolean(device.forceHealth),
        screenDisplay,
      };

      if (!flags.mildewProof && !flags.health && flags.screenDisplay === 'none') {
        continue;
      }

      if (device.endpointId) {
        this.byEndpoint.set(device.endpointId, flags);
      }
      if (device.mac) {
        this.byMac.set(device.mac.toLowerCase(), flags);
      }
    }

    if (this.hasAny()) {
      this.log.debug(
        'Forced feature switches configured for %d device(s)',
        Math.max(this.byEndpoint.size, this.byMac.size),
      );
    }
  }

  private warnUnsupported(device: AuxDevice, setting: string, param: string): void {
    const key = `${device.endpointId}:${param}`;
    if (this.unsupportedWarned.has(key)) {
      return;
    }
    this.unsupportedWarned.add(key);
    this.log.warn(
      '%s is enabled for "%s", but the device does not report the %s parameter. Ignoring the setting.',
      setting,
      device.friendlyName,
      param,
    );
  }
}

/**
 * Resolve the forced value a feature switch must report for a given parameter,
 * or `undefined` when there is no forced override for it. `ac_health` is never
 * resolved here: forceHealth only injects the value into outgoing commands and
 * exposes no switch.
 */
export function resolveForcedValue(
  flags: ForcedFeatureFlags,
  param: string,
): boolean | undefined {
  if (param === AC_MILDEW_PROOF) {
    return flags.mildewProof ? true : undefined;
  }

  if (param === AC_SCREEN_DISPLAY) {
    if (flags.screenDisplay === 'forceOn') {
      return true;
    }
    if (flags.screenDisplay === 'forceOff') {
      return false;
    }
    return undefined;
  }

  return undefined;
}
