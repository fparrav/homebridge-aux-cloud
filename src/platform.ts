import type {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';

import { AuxCloudPlatformAccessory } from './platformAccessory';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

interface AuxCloudDevice {
  id: string;
  name: string;
}

export interface AuxCloudPlatformConfig extends PlatformConfig {
  username?: string;
  password?: string;
  pollInterval?: number;
  devices?: AuxCloudDevice[];
}

export class AuxCloudPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  public readonly accessories: PlatformAccessory[] = [];
  private readonly config: AuxCloudPlatformConfig;

  constructor(
    public readonly log: Logger,
    config: PlatformConfig,
    public readonly api: API,
  ) {
    this.config = config as AuxCloudPlatformConfig;
    this.log.debug('Finished initializing platform:', this.config.name);

    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  private discoverDevices(): void {
    const configuredDevices = this.config.devices ?? [];
    const fallbackDevices: AuxCloudDevice[] = configuredDevices.length > 0 ? [] : [{
      id: 'aux-device-001',
      name: 'Sample AUX Device',
    }];

    const devices: AuxCloudDevice[] = configuredDevices.length > 0 ? configuredDevices : fallbackDevices;

    if (!devices.length) {
      this.log.warn('No devices configured or discovered. Add credentials to enable discovery.');
      return;
    }

    for (const device of devices) {
      const uuid = this.api.hap.uuid.generate(device.id);
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (existingAccessory) {
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
        existingAccessory.context.device = device;
        new AuxCloudPlatformAccessory(this, existingAccessory);
      } else {
        this.log.info('Adding new accessory:', device.name);
        const accessory = new this.api.platformAccessory(device.name, uuid);
        accessory.context.device = device;

        new AuxCloudPlatformAccessory(this, accessory);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }
}
