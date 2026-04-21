import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import {
  AuxApiError,
  AuxCloudClient,
  type AuxDevice,
} from './api/AuxCloudClient';
import { AuxCloudPlatformAccessory } from './platformAccessory';
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

  private readonly credentialsConfigured: boolean;

  public readonly temperatureUnit: 'C' | 'F';

  public readonly temperatureStep: number;

  public readonly featureSwitches: Set<FeatureSwitchKey>;

  private readonly commandRetryCount: number;
  private readonly commandTimeoutMs: number;

  private readonly handlers = new Map<string, AuxCloudPlatformAccessory>();

  private readonly devicesById = new Map<string, AuxDevice>();

   // Track pending commands per device to avoid stale refresh overwriting optimistic state
  private pendingCommands = new Map<
    string,
     { sequence: number; timestamp: number; expectedState: number }
   >();

  private refreshTimer?: NodeJS.Timeout;

  private isSyncing = false;

  private refreshDebounce?: NodeJS.Timeout;

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
    * Envía params a la cloud con retry y timeout configurable.
    * Espera a que terminen todos los intentos (o hasta el éxito).
    */
  public async sendDeviceParamsWithRetry(
    device: AuxDevice,
    params: Record<string, number>,
    retryCount: number = this.commandRetryCount,
   ): Promise<void> {
    const attempts = retryCount + 1;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        await this.client.setDeviceParams(device, params);
        return;
       } catch (error) {
        this.log.debug(
           'AuxCloudPlatform: attempt %d/%d failed for %s: %s',
          attempt + 1,
          attempts,
          device.endpointId,
          error instanceof Error ? error.message : String(error),
         );

        if (attempt < retryCount) {
          const delayMs = Math.min(500 * Math.pow(2, attempt), 3000);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
         }
       }
     }

    const message = `Failed to control ${device.endpointId} after ${attempts} attempts`;
    this.log.error('%s. Params: %o', message, params);
    throw new AuxApiError(message);
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
         // Silently ignore — el caller ya aplicó estado optimista.
         // El poll de 60s confirmará o el usuario reintentará.
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
    const pending = this.pendingCommands.get(endpointId);
    if (!pending) {
      return false;
     }
    return Date.now() - pending.timestamp < 4000;
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
}
