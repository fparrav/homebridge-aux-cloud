import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { AuxApiError, AuxCloudClient, type AuxDevice } from './api/AuxCloudClient';
import { AuxDeviceControl } from './api/AuxDeviceControl';
import { AuxCloudPlatformAccessory } from './platformAccessory';
import { MatterThermostatAccessory } from './MatterThermostatAccessory';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

export type FeatureSwitchKey =
   | 'screenDisplay'
   | 'mildewProof'
   | 'clean'
   | 'health'
   | 'eco'
   | 'sleep';

const ALLOWED_FEATURE_SWITCHES: FeatureSwitchKey[] = [
   'screenDisplay',
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
  temperatureUnit?: 'C' | 'F';
  temperatureStep?: number;
  featureSwitches?: string[];
  pollInterval?: number;
  includeDeviceIds?: string[];
  excludeDeviceIds?: string[];

   // Optimistic UI settings
  commandRetryCount?: number;
  commandTimeoutMs?: number;

     // Local (LAN) control settings
  controlStrategy?: 'local-first' | 'cloud-only';
  localControlEnabled?: boolean;
  enableMatter?: boolean;
  enableHomeKit?: boolean;
  devices?: Array<{
    endpointId?: string;
    mac?: string;
    ip?: string;
    name?: string;
    controlStrategy?: 'local' | 'cloud';
    enableHAP?: boolean;
    enableMatter?: boolean;
   }>;
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

  private readonly deviceControl: AuxDeviceControl;

  private readonly includeIds: Set<string>;

  private readonly excludeIds: Set<string>;

  private readonly credentialsConfigured: boolean;

  public readonly temperatureUnit: 'C' | 'F';

  public readonly temperatureStep: number;

  public readonly featureSwitches: Set<FeatureSwitchKey>;

  public readonly commandRetryCount: number;
  public readonly commandTimeoutMs: number;
  public readonly enableHomeKit: boolean;

  private readonly handlers = new Map<string, AuxCloudPlatformAccessory>();

  private readonly devicesById = new Map<string, AuxDevice>();

   // Track pending commands per device to avoid stale refresh overwriting optimistic state
  private pendingCommands = new Map<
    string,
     { sequence: number; timestamp: number; expectedState: number }
   >();

  private isSyncing = false;

  // Cache last known cloud devices for resilience when cloud is unreachable
  private lastKnownCloudDevices: AuxDevice[] = [];

  private refreshDebounce?: NodeJS.Timeout;

    // Matter accessory instances
  private readonly matterAccessories: MatterThermostatAccessory[] = [];

  // Cache of Matter accessories restored from persistence at startup (UUID → accessory)
  private readonly cachedMatterAccessories = new Map<string, unknown>();

  constructor(
    public readonly log: Logger,
    config: PlatformConfig,
    public readonly api: API,
   ) {
    this.config = (config ?? {}) as AuxCloudPlatformConfig;
    this.credentialsConfigured = Boolean(this.config.username && this.config.password);
    if (!this.credentialsConfigured) {
      this.log.info('AUX Cloud plugin is installed but not configured; skipping initialization until credentials are provided.');
     }

    this.includeIds = new Set(this.config.includeDeviceIds ?? []);
    this.excludeIds = new Set(this.config.excludeDeviceIds ?? []);

    this.temperatureUnit = this.config.temperatureUnit === 'F' ? 'F' : 'C';
    const configuredStep = this.config.temperatureStep === 1 ? 1 : 0.5;
    this.temperatureStep = this.temperatureUnit === 'F' ? 1 : configuredStep;
    if (this.temperatureUnit === 'F' && configuredStep !== 1) {
      this.log.debug('Using 1°F increments when displaying temperatures.');
     }

    const configuredFeatureSwitches = new Set(
       (this.config.featureSwitches ?? []).filter((value): value is FeatureSwitchKey =>
        ALLOWED_FEATURE_SWITCHES.includes(value as FeatureSwitchKey),
       ),
     );
    this.featureSwitches = configuredFeatureSwitches;

      // HomeKit registration toggle (default true — disabled Matter only mode)
    this.enableHomeKit = this.config.enableHomeKit !== false;

     // Retry / timeout config
    this.commandRetryCount =
       this.config.commandRetryCount !== undefined && this.config.commandRetryCount >= 0
        ? Math.min(this.config.commandRetryCount, 5)
        : 2;
    this.commandTimeoutMs =
       this.config.commandTimeoutMs !== undefined
        ? Math.max(1000, Math.min(15000, this.config.commandTimeoutMs))
        : 5000;

     // Create the client with custom timeout
    this.client = new AuxCloudClient({
      region: this.config.region ?? 'eu',
      logger: this.log,
      requestTimeoutMs: this.commandTimeoutMs,
     });

      // Device control with local/cloud selection — share the platform's logged-in client
      this.deviceControl = new AuxDeviceControl({
        region: this.config.region ?? 'eu',
        logger: this.log,
        commandTimeoutMs: this.commandTimeoutMs,
        commandRetryCount: this.commandRetryCount,
        localControlEnabled: this.config.localControlEnabled,
        devices: this.config.devices,
        cloudClient: this.client,
      });

    this.log.debug(
       'Finished initializing platform: %s (retryCount=%d, timeout=%dms)',
      this.config.name,
      this.commandRetryCount,
      this.commandTimeoutMs,
     );

    this.api.on('didFinishLaunching', () => {
      if (!this.credentialsConfigured) {
        return;
      }

      const hbVersion = (this.api.packageJSON as { version?: string })?.version ?? '0.0.0';
      const hbMajor = parseInt(hbVersion.split('.')[0], 10);
      const matterAvailable = this.api.isMatterAvailable?.() ?? false;
      const matterEnabled = this.api.isMatterEnabled?.() ?? false;

      if (this.config.enableMatter) {
        if (hbMajor < 2) {
          this.log.warn(
            '[Matter] Homebridge v2.0+ is required for Matter support (current: v%s). ' +
            'Upgrade Homebridge to enable Matter accessories.',
            hbVersion,
          );
        } else if (!matterAvailable) {
          this.log.warn(
            '[Matter] Matter is not available on this Homebridge installation. ' +
            'Enable Matter in Homebridge Settings to use Matter accessories.',
          );
        } else if (!matterEnabled) {
          this.log.warn(
            '[Matter] Matter is installed but not enabled. ' +
            'Enable it in Homebridge Settings → Matter.',
          );
        } else {
          this.log.info('[Matter] Matter available and enabled (Homebridge v%s)', hbVersion);
        }
      }

      void this.initialize().then(() => {
        if (this.config.enableMatter && matterAvailable && matterEnabled) {
          void this.registerMatterAccessories();
        }
      });
    });
   }

  configureAccessory(accessory: PlatformAccessory): void {
    if (!AuxCloudPlatform.hasValidContext(accessory)) {
      this.log.warn('Removing legacy AUX accessory without endpoint id: %s', accessory.displayName);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      return;
     }

    this.log.info('Loading accessory from cache: %s', accessory.displayName);
    if (this.enableHomeKit) {
      this.accessories.push(accessory);
       }

    if (!this.handlers.has(accessory.UUID)) {
      const handler = new AuxCloudPlatformAccessory(this, accessory);
      this.handlers.set(accessory.UUID, handler);
     }
   }

  configureMatterAccessory(accessory: unknown): void {
    const acc = accessory as { UUID: string; displayName: string };
    this.log.info('[Matter] Restoring cached: %s (%s)', acc.displayName, acc.UUID);
    this.cachedMatterAccessories.set(acc.UUID, accessory);
  }

  public getDevice(endpointId: string): AuxDevice | undefined {
    return this.devicesById.get(endpointId);
   }

  public updateCachedDevice(device: AuxDevice): void {
    this.devicesById.set(device.endpointId, device);
   }

   /**
    * @deprecated Mantener por compatibilidad con setAuxMode legacy.
    * Usar startDeviceCommand() para nuevos handlers.
    */
  public async sendDeviceParams(
    device: AuxDevice,
    params: Record<string, number>,
   ): Promise<void> {
    await this.sendDeviceParamsWithRetry(device, params);
   }


      /**
       * Envía params al dispositivo con local/cloud selection y retry.
       * Delega a AuxDeviceControl para selección automática.
       */
      public async sendDeviceParamsWithRetry(
        device: AuxDevice,
        params: Record<string, number>,
        retryCount: number = this.commandRetryCount,
        ): Promise<void> {
         // Ensure cloud session is valid before sending command
        if (this.credentialsConfigured) {
          await this.client.ensureLoggedIn(this.config.username!, this.config.password!);
         }
        try {
          await this.deviceControl.sendCommand(device, params, {
            globalStrategy: this.config.controlStrategy,
            localRetryCount: retryCount,
            cloudRetryCount: retryCount,
             });
           } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.log.error('Failed to control %s: %s. Params: %o', device.endpointId, message, params);
          throw new AuxApiError(message);
           }
         }


   /**
    * Dispara el comando en background. El caller ya aplicó el estado optimista.
    */
  public startDeviceCommand(
    device: AuxDevice,
    params: Record<string, number>,
    retryCount: number = this.commandRetryCount,
   ): void {
    void (async () => {
      try {
        await this.sendDeviceParamsWithRetry(device, params, retryCount);
       } catch {
           // Command failed — schedule quick refresh to sync HomeKit state
        this.requestRefresh(500);
       }
     })();
   }

   /**
    * Registra un comando pendiente. Previene que el poll sobreescriba
    * el estado optimista antes de que la cloud confirme.
    * Retorna el número de secuencia, o null si ya existe uno más nuevo.
    */
  public registerPendingCommandWithState(
    endpointId: string,
    expectedState: 0 | 1,
   ): number | null {
    const existing = this.pendingCommands.get(endpointId);
    const seq = (existing?.sequence ?? 0) + 1;

    if (existing && existing.sequence >= seq) {
      return null;
     }

    this.pendingCommands.set(endpointId, {
      sequence: seq,
      timestamp: Date.now(),
      expectedState,
     });
    return seq;
   }

  public registerPendingCommand(endpointId: string): number | null {
    return this.registerPendingCommandWithState(endpointId, 1);
   }

   /**
    * Marca el comando pendiente como completado.
    * A partir de aquí el poll puede actualizar el estado normalmente.
    */
  public completePendingCommand(endpointId: string): void {
    this.pendingCommands.delete(endpointId);
   }

   /**
    * Retorna true si hay un comando pendiente activo (< 4s desde el registro).
    * Usado en reconcileAccessories para saltar actualizaciones stale.
    */
  public isStaleState(endpointId: string): boolean {
    return this.pendingCommands.has(endpointId);
   }

  public requestRefresh(delayMs = 1_500): void {
    if (this.refreshDebounce) {
      clearTimeout(this.refreshDebounce);
     }

    this.refreshDebounce = setTimeout(() => {
      void this.refreshDevices();
     }, delayMs);
   }

  private getLanOnlyDevices(): AuxDevice[] {
    if (!this.config.localControlEnabled) return [];
    return this.deviceControl.getLanOnlyMappings().map((mapping) => {
      const normalizedMac = mapping.mac.toLowerCase();
      const endpointId = `lan-${normalizedMac.replace(/:/g, '')}`;
      return (
        this.devicesById.get(endpointId) ?? {
          endpointId,
          friendlyName: mapping.name,
          productId: 'broadlink',
          devSession: '',
          devicetypeFlag: 0,
          cookie: '',
          mac: normalizedMac,
          // Default params so fan/switch accessories appear before first LAN poll
          params: {
            pwr: 0,
            temp: 240,    // 24°C ×10
            ac_mode: 4,   // AUTO
            ac_mark: 0,   // AUTO fan speed
            ac_vdir: 0,
            ac_hdir: 0,
            ac_slp: 0,
            scrdisp: 0,
            mldprf: 0,
            ac_health: 0,
            ac_clean: 0,
            mute: 0,
            turbo: 0,
          },
          state: 1,
           // LAN-only: siempre considerado online; poll actualiza params, no conectividad
        }
      );
    });
  }

  private async initialize(): Promise<void> {
    if (this.config.localControlEnabled) {
      const { DeviceDiscovery } = await import('./api/broadlink/DeviceDiscovery');
      const devicesWithStaticIp = (this.config.devices ?? []).filter((d) => d.ip && d.mac);
      try {
        const discovered = await DeviceDiscovery.discover(3000);
        if (discovered.length === 0 && devicesWithStaticIp.length === 0) {
          throw new Error('LAN discovery found no Broadlink devices and no static IP/MAC configured. Check your network or disable localControlEnabled.');
        }
        for (const dev of discovered) {
          this.deviceControl.registerDiscoveredDevice(dev);
          this.log.info('Discovered Broadlink device: %s (MAC: %s)', dev.ip, dev.mac);
        }
        if (discovered.length === 0) {
          this.log.warn('[Aux Cloud] LAN discovery found no devices via broadcast. Using static IP/MAC from config.');
        }
      } catch (error) {
        if (devicesWithStaticIp.length === 0) {
          throw error;
        }
        this.log.warn('[Aux Cloud] LAN discovery broadcast failed (%s). Using static IP/MAC from config.', error);
      }
    }

      await this.refreshDevices();

      const intervalSeconds = this.validatePollInterval(this.config.pollInterval);
      setInterval(() => {
        void this.refreshDevices();
         }, intervalSeconds * 1000);
        }

  private validatePollInterval(interval?: number): number {
    if (!interval || Number.isNaN(interval) || interval < 15) {
      return 30;
     }
    if (interval > 600) {
      return 600;
     }
    return interval;
   }



  public async refreshDevices(): Promise<void> {
    if (this.isSyncing) {
      return;
    }
    this.isSyncing = true;

    try {
      let cloudDevices: AuxDevice[] = [];

      try {
        await this.client.ensureLoggedIn(this.config.username!, this.config.password!);
        cloudDevices = await this.client.listDevices({
          includeIds: this.includeIds,
          excludeIds: this.excludeIds,
        });
        this.lastKnownCloudDevices = cloudDevices; // update cache
        this.log.debug('Fetched %d AUX Cloud devices', cloudDevices.length);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log.warn('Failed to fetch AUX Cloud devices: %s', message);
          // If cloud fails, use cached devices so cloud devices don't disappear as stale
        cloudDevices = this.lastKnownCloudDevices.length > 0
             ? this.lastKnownCloudDevices
             : cloudDevices; // empty (first run with no cloud)
        this.client.invalidateSession();
      }

      const lanOnlyDevices = this.getLanOnlyDevices();
      const allDevices = [...cloudDevices, ...lanOnlyDevices];

      if (this.config.localControlEnabled) {
        // Poll all devices in parallel — eliminates serial wait on auth timeouts
        await Promise.all(allDevices.map(async (device) => {
          const mac = device.mac;
          if (!mac) return;
          const mapping = this.deviceControl.getDeviceMapping(mac);
          if (!mapping) return;
          try {
            const localParams = await this.deviceControl.pollLocalState(mapping.ip, mapping.mac);
            if (localParams != null) {
              device.params = { ...device.params, ...localParams };
              device.state = 1;
              this.log.info('[LAN] Poll OK for %s', device.endpointId)
            }
          } catch {
            this.deviceControl.recordFailure(device.endpointId);
            this.log.warn('[LAN] Poll failed for %s', device.endpointId)
          }
        }));
      }

      if (allDevices.length > 0) {
        this.reconcileAccessories(allDevices);

         // Update Matter accessory states
        this.refreshMatterState();
      }
    } finally {
      this.isSyncing = false;
    }
  }

  private reconcileAccessories(devices: AuxDevice[]): void {
    const seen = new Set<string>();

    for (const device of devices) {
      const existingDevice = this.devicesById.get(device.endpointId);
      const mergedDevice = existingDevice
         ? {
           ...existingDevice,
           ...device,
          params: this.mergeParams(existingDevice.params, device.params),
          state: device.state ?? existingDevice.state,
          lastUpdated: device.lastUpdated ?? existingDevice.lastUpdated,
         }
         : {
           ...device,
          params: device.params ?? {},
         };

       // Si hay comando pendiente activo (< 4s), conservar los params optimistas locales
      if (this.isStaleState(device.endpointId) && existingDevice) {
        mergedDevice.params = { ...existingDevice.params };
        mergedDevice.state = existingDevice.state ?? mergedDevice.state;
       }

      const isKnownDevice = Boolean(existingDevice);
      this.devicesById.set(device.endpointId, mergedDevice);
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
          endpointId: mergedDevice.endpointId,
          productId: mergedDevice.productId,
          friendlyName: mergedDevice.friendlyName,
         };

        const handler = this.handlers.get(existingAccessory.UUID) ?? new AuxCloudPlatformAccessory(this, existingAccessory);
        handler.updateAccessory(mergedDevice);
        this.handlers.set(existingAccessory.UUID, handler);
       } else {
        this.log.info('Adding new accessory: %s', mergedDevice.friendlyName);
        const accessory = new this.api.platformAccessory(mergedDevice.friendlyName, uuid);
        accessory.context.device = {
          endpointId: mergedDevice.endpointId,
          productId: mergedDevice.productId,
          friendlyName: mergedDevice.friendlyName,
         };

        const handler = new AuxCloudPlatformAccessory(this, accessory);
        handler.updateAccessory(mergedDevice);

        const deviceConfig = this.config.devices?.find((d) => d.mac === mergedDevice.mac);
        const hapEnabled = this.enableHomeKit && (deviceConfig?.enableHAP !== false);
        if (hapEnabled) {
          this.accessories.push(accessory);
          this.handlers.set(accessory.UUID, handler);
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
     }
      }


    if (this.enableHomeKit) {
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



  private mergeParams(
    existing: Record<string, number> | undefined,
    incoming: Record<string, number> | undefined,
   ): Record<string, number> {
    const merged: Record<string, number> = { ...(existing ?? {}) };

    if (incoming) {
      for (const [key, value] of Object.entries(incoming)) {
        if (typeof value === 'number' && !Number.isNaN(value)) {
          merged[key] = value;
         }
       }
     }

    return merged;
   }

    // ─────────────────────────────────────────────
    // Matter accessory registration
    // ─────────────────────────────────────────────

    private async registerOrResumeAccessories(
      accessories: unknown[],
      deviceName: string,
    ): Promise<void> {
      for (const acc of accessories) {
        const uuid = (acc as { UUID: string }).UUID;
        const cached = this.cachedMatterAccessories.get(uuid);
        if (cached) {
          // Re-attach handlers to the endpoint already in StateManager from persistence.
          // updatePlatformAccessories does NOT touch StateManager — safe to call at runtime.
          (cached as Record<string, unknown>).handlers = (acc as Record<string, unknown>).handlers;
          (cached as Record<string, unknown>).parts = (acc as Record<string, unknown>).parts;
          await this.api.matter.updatePlatformAccessories([cached]);
          this.log.info('[Matter] "%s" resumed — handlers re-attached', deviceName);
        } else {
          // registerPlatformAccessories is fire-and-forget: always resolves, fails internally
          // with identity-conflict for persisted endpoints (no throw). Then updatePlatformAccessories
          // ensures the accessories Map has the entry with current handlers, whether the endpoint
          // was just freshly registered or already existed from persistence.
          await this.api.matter.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [acc]);
          await this.api.matter.updatePlatformAccessories([acc]);
          this.log.info('[Matter] "%s" registered and updated', deviceName);
        }
      }
    }

    private async registerMatterAccessories(): Promise<void> {
      const allDevices = [...this.devicesById.values()];
      for (const device of allDevices) {
        const deviceConfig = this.config.devices?.find((d) => d.mac === device.mac);
        if (deviceConfig?.enableMatter === false) continue;
        try {
          const matterAccessory = new MatterThermostatAccessory(this, device);
          const thermostat = matterAccessory.toAccessory();
          const switches = matterAccessory.getMatterSwitchAccessories();

          // Nest switches as parts of the thermostat so they appear grouped in Home
          if (switches.length > 0) {
            (thermostat as Record<string, unknown>).parts = switches;
          }
          await this.registerOrResumeAccessories([thermostat], device.friendlyName);

          // Only add to poll list after successful registration (or resume from persistence)
          this.matterAccessories.push(matterAccessory);
          this.log.info('[Matter] Registered "%s" (%d switches)', device.friendlyName, switches.length);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.log.error('[Matter] Failed to register accessory for "%s": %s', device.friendlyName, message);
        }
      }
    }

    private unregisterMatterAccessories(): void {
      if (this.matterAccessories.length === 0) {
        return;
      }

      const allAccessories: unknown[] = [];
      for (const matterAccessory of this.matterAccessories) {
        // Only the thermostat is registered directly; switches are parts and unregistered with it
        allAccessories.push(matterAccessory.toAccessory());
      }

      this.api.matter.unregisterPlatformAccessories(
        PLUGIN_NAME,
        PLATFORM_NAME,
        allAccessories,
      );
      this.matterAccessories.length = 0;
      this.log.info('[Matter] Unregistered all accessories');
    }

    // DynamicPlatformPlugin hook — called when the platform is unloaded
    onPlatformUnload(): void {
      this.unregisterMatterAccessories();
    }

    // ─────────────────────────────────────────────
    // Matter state refresh — called on each poll
    // ─────────────────────────────────────────────

    private refreshMatterState(): void {
      for (const matterAccessory of this.matterAccessories) {
        void matterAccessory.refresh();
      }
    }

}
