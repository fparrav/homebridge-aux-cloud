import type { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';

import { AuxCloudHAPPlatform } from './Platform.HAP';
import { AuxCloudMatterPlatform } from './Platform.Matter';
import type { AuxCloudPlatformConfig } from './types';

interface InitializablePlatform extends DynamicPlatformPlugin {
  initialize(): Promise<void>;
}

export class AuxCloudPlatformProxy implements DynamicPlatformPlugin {
  private inner?: InitializablePlatform;
  private readonly bufferedAccessories: PlatformAccessory[] = [];

  constructor(
    private readonly log: Logger,
    private readonly config: PlatformConfig,
    private readonly api: API,
  ) {
    this.api.on('didFinishLaunching', () => { void this.onDidFinishLaunching(); });
  }

  private async onDidFinishLaunching(): Promise<void> {
    const cfg = this.config as AuxCloudPlatformConfig;
    const matterAvailable = this.api.isMatterAvailable?.() ?? false;
    const matterEnabled = this.api.isMatterEnabled?.() ?? false;
    const useMatter = Boolean(cfg.enableMatter) && matterAvailable && matterEnabled;

    if (useMatter) {
      this.log.info('[Platform] Matter available — using Matter platform');
      this.inner = new AuxCloudMatterPlatform(this.log, this.config, this.api);
    } else {
      if (cfg.enableMatter && !matterAvailable) {
        this.log.warn('[Platform] Matter not available; falling back to HAP');
      } else if (cfg.enableMatter && matterAvailable && !matterEnabled) {
        this.log.warn('[Platform] Matter not enabled in Homebridge settings; falling back to HAP');
      } else {
        this.log.info('[Platform] Initializing HAP platform');
      }
      this.inner = new AuxCloudHAPPlatform(this.log, this.config, this.api);
    }

    // Replay buffered configureAccessory calls to the chosen platform
    for (const accessory of this.bufferedAccessories) {
      this.inner.configureAccessory(accessory);
    }
    this.bufferedAccessories.length = 0;

    await this.inner.initialize();
  }

  configureAccessory(accessory: PlatformAccessory): void {
    if (this.inner) {
      this.inner.configureAccessory(accessory);
    } else {
      this.bufferedAccessories.push(accessory);
    }
  }
}
