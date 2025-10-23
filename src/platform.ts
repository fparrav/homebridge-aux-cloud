import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { AuxCloudClient, type AuxDevice } from './api/AuxCloudClient';
import { AuxCloudPlatformAccessory } from './platformAccessory';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

export type FeatureSwitchKey =
  | 'childLock'
  | 'screenDisplay'
  | 'comfortableWind'
  | 'mildewProof'
  | 'clean'
  | 'health'
  | 'eco'
  | 'sleep';

const ALLOWED_FEATURE_SWITCHES: FeatureSwitchKey[] = [
  'childLock',
  'screenDisplay',
  'comfortableWind',
  'mildewProof',
  'clean',
  'health',
  'eco',
  'sleep',
];

export interface AuxCloudPlatformConfig extends PlatformConfig {
  username?: string;
  password?: string;
  region?: 'eu' | 'usa' | 'cn';
  baseUrl?: string;
  fanControlMode?: 'slider' | 'preset' | 'disabled';
  enableSwingControl?: boolean;
  temperatureUnit?: 'C' | 'F';
  temperatureStep?: number;
  featureSwitches?: string[];
  pollInterval?: number;
  includeDeviceIds?: string[];
  excludeDeviceIds?: string[];
}

export class AuxCloudPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  public readonly accessories: PlatformAccessory[] = [];

  private static hasValidContext(accessory: PlatformAccessory): boolean {
    const context = accessory.context as { device?: { endpointId?: string } };
    return Boolean(context.device?.endpointId);
  }

  private readonly config: AuxCloudPlatformConfig;

  private readonly client: AuxCloudClient;

  private readonly includeIds: Set<string>;

  private readonly excludeIds: Set<string>;

  public readonly temperatureUnit: 'C' | 'F';

  public readonly temperatureStep: number;

  public readonly fanControlMode: 'slider' | 'preset' | 'disabled';

  public readonly swingControlEnabled: boolean;

  public readonly featureSwitches: Set<FeatureSwitchKey>;

  private readonly handlers = new Map<string, AuxCloudPlatformAccessory>();

  private readonly devicesById = new Map<string, AuxDevice>();

  private refreshTimer?: NodeJS.Timeout;

  private isSyncing = false;

  private refreshDebounce?: NodeJS.Timeout;

  constructor(
    public readonly log: Logger,
    config: PlatformConfig,
    public readonly api: API,
  ) {
    this.config = config as AuxCloudPlatformConfig;
    this.includeIds = new Set(this.config.includeDeviceIds ?? []);
   this.excludeIds = new Set(this.config.excludeDeviceIds ?? []);

    this.temperatureUnit = this.config.temperatureUnit === 'F' ? 'F' : 'C';
    const configuredStep = this.config.temperatureStep === 1 ? 1 : 0.5;
    this.temperatureStep = this.temperatureUnit === 'F' ? 1 : configuredStep;
    if (this.temperatureUnit === 'F' && configuredStep !== 1) {
      this.log.debug('Using 1°F increments when displaying temperatures.');
    }

    this.fanControlMode = this.config.fanControlMode === 'preset'
      ? 'preset'
      : this.config.fanControlMode === 'disabled'
        ? 'disabled'
        : 'slider';
    this.swingControlEnabled = this.config.enableSwingControl ?? true;
    const configuredFeatureSwitches = new Set(
      (this.config.featureSwitches ?? []).filter((value): value is FeatureSwitchKey =>
        ALLOWED_FEATURE_SWITCHES.includes(value as FeatureSwitchKey),
      ),
    );
    this.featureSwitches = configuredFeatureSwitches;

    this.client = new AuxCloudClient({
      region: this.config.region ?? 'eu',
      baseUrl: this.config.baseUrl,
      logger: this.log,
    });

    this.log.debug('Finished initializing platform: %s', this.config.name);

    this.api.on('didFinishLaunching', () => {
      void this.initialize();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    if (!AuxCloudPlatform.hasValidContext(accessory)) {
      this.log.warn('Removing legacy AUX accessory without endpoint id: %s', accessory.displayName);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      return;
    }

    this.log.info('Loading accessory from cache: %s', accessory.displayName);
    this.accessories.push(accessory);

    if (!this.handlers.has(accessory.UUID)) {
      const handler = new AuxCloudPlatformAccessory(this, accessory);
      this.handlers.set(accessory.UUID, handler);
    }
  }

  public getDevice(endpointId: string): AuxDevice | undefined {
    return this.devicesById.get(endpointId);
  }

  public updateCachedDevice(device: AuxDevice): void {
    this.devicesById.set(device.endpointId, device);
  }

  public async sendDeviceParams(device: AuxDevice, params: Record<string, number>): Promise<void> {
    await this.client.setDeviceParams(device, params);
    this.requestRefresh(2_000);
  }

  public requestRefresh(delayMs = 1_500): void {
    if (this.refreshDebounce) {
      clearTimeout(this.refreshDebounce);
    }

    this.refreshDebounce = setTimeout(() => {
      void this.refreshDevices();
    }, delayMs);
  }

  private async initialize(): Promise<void> {
    if (!this.config.username || !this.config.password) {
      this.log.error('AUX Cloud credentials are not configured. Please update the plugin settings.');
      return;
    }

    await this.refreshDevices();

    const intervalSeconds = this.validatePollInterval(this.config.pollInterval);
    this.refreshTimer = setInterval(() => {
      void this.refreshDevices();
    }, intervalSeconds * 1000);
  }

  private validatePollInterval(interval?: number): number {
    if (!interval || Number.isNaN(interval) || interval < 30) {
      return 60;
    }
    if (interval > 600) {
      return 600;
    }
    return interval;
  }

  private async refreshDevices(): Promise<void> {
    if (this.isSyncing) {
      return;
    }
    this.isSyncing = true;

    try {
      await this.client.ensureLoggedIn(this.config.username!, this.config.password!);

      const devices = await this.client.listDevices({
        includeIds: this.includeIds,
        excludeIds: this.excludeIds,
      });

      this.log.debug('Fetched %d AUX Cloud devices', devices.length);
      this.reconcileAccessories(devices);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.error('Failed to refresh AUX Cloud devices: %s', message);
      this.client.invalidateSession();
    } finally {
      this.isSyncing = false;
    }
  }

  private reconcileAccessories(devices: AuxDevice[]): void {
    const seen = new Set<string>();

    for (const device of devices) {
      const isKnownDevice = this.devicesById.has(device.endpointId);
      this.devicesById.set(device.endpointId, device);
      const uuid = this.api.hap.uuid.generate(device.endpointId);
      seen.add(uuid);

      if (!isKnownDevice) {
        this.log.info(
          'Discovered AUX device "%s" (endpointId: %s, productId: %s)',
          device.friendlyName,
          device.endpointId,
          device.productId,
        );
        this.log.debug(
          'Use includeDeviceIds/excludeDeviceIds in the plugin configuration to control exposure (%s)',
          device.endpointId,
        );
      }

      const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

      if (existingAccessory) {
        existingAccessory.context.device = {
          endpointId: device.endpointId,
          productId: device.productId,
          friendlyName: device.friendlyName,
        };

        const handler = this.handlers.get(existingAccessory.UUID) ?? new AuxCloudPlatformAccessory(this, existingAccessory);
        handler.updateAccessory(device);
        this.handlers.set(existingAccessory.UUID, handler);
      } else {
        this.log.info('Adding new accessory: %s', device.friendlyName);
        const accessory = new this.api.platformAccessory(device.friendlyName, uuid);
        accessory.context.device = {
          endpointId: device.endpointId,
          productId: device.productId,
          friendlyName: device.friendlyName,
        };

        const handler = new AuxCloudPlatformAccessory(this, accessory);
        handler.updateAccessory(device);

        this.accessories.push(accessory);
        this.handlers.set(accessory.UUID, handler);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }

    const staleAccessories = this.accessories.filter((accessory) => !seen.has(accessory.UUID));
    if (staleAccessories.length > 0) {
      this.log.info('Removing %d stale AUX Cloud accessories', staleAccessories.length);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories);

      for (const accessory of staleAccessories) {
        this.handlers.delete(accessory.UUID);
        const index = this.accessories.indexOf(accessory);
        if (index >= 0) {
          this.accessories.splice(index, 1);
        }
      }
    }
  }
}
