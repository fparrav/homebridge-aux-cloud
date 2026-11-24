import type { API, Logger, PlatformConfig } from 'homebridge';

import type { AuxDevice } from './api/AuxCloudClient';
import type { AuxProvider, AuxProviderKind } from './api/providers/AuxProvider';
import type { CreateProviderOptions } from './api/providers/createProvider';

export type FeatureSwitchKey =
  | 'screenDisplay'
  | 'mildewProof'
  | 'clean'
  | 'health'
  | 'eco'
  | 'sleep';

/**
 * Tri-state override for the screen display:
 * - 'none'      -> no override, the HomeKit/Matter switch controls it
 * - 'forceOn'   -> scrdisp=1 is sent with every command
 * - 'forceOff'  -> scrdisp=0 is sent with every command
 */
export type ScreenDisplayForceMode = 'none' | 'forceOn' | 'forceOff';

export interface ForcedFeatureFlags {
  mildewProof: boolean;
  clean: boolean;
  screenDisplay: ScreenDisplayForceMode;
}

export const ALLOWED_FEATURE_SWITCHES: FeatureSwitchKey[] = [
  'screenDisplay',
  'mildewProof',
  'clean',
  'health',
  'eco',
  'sleep',
];

export interface AuxCloudPlatformDependencies {
  providerFactory?: (options: CreateProviderOptions) => AuxProvider;
  closeProviderOnUnload?: boolean;
}

export interface AuxCloudPlatformConfig extends PlatformConfig {
  provider?: AuxProviderKind;
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
  requestTimeoutMs?: number;

  // Local (LAN) control settings
  controlStrategy?: 'local-first' | 'cloud-only';
  localControlEnabled?: boolean;

  // Exposure mode: 'hap' (default), 'matter', or 'both' (HAP + Matter simultaneously)
  expose?: 'hap' | 'matter' | 'both';
  // Legacy aliases kept for backward compatibility
  enableMatter?: boolean;
  enableHomeKit?: boolean;
  devices?: Array<{
    endpointId?: string;
    mac?: string;
    ip?: string;
    name?: string;
    controlStrategy?: 'local' | 'cloud';
    bridge?: 'HAP' | 'Matter';
    forceMildewProof?: boolean;
    forceClean?: boolean;
    forceScreenDisplay?: ScreenDisplayForceMode;
  }>;
}

export interface IAuxCloudPlatform {
  readonly api: API;
  readonly log: Logger;
  readonly featureSwitches: Set<FeatureSwitchKey>;
  readonly temperatureStep: number;
  readonly commandTimeoutMs: number;
  readonly commandRetryCount: number;
  readonly redactDeviceIdentifiers: boolean;
  registerPendingCommand(endpointId: string): number | null;
  completePendingCommand(endpointId: string): void;
  schedulePendingCommandCompletion(endpointId: string, delayMs: number): void;
  isStaleState(endpointId: string): boolean;
  getForcedFeatures(endpointId: string, mac?: string): ForcedFeatureFlags | undefined;
  startDeviceCommand(device: AuxDevice, params: Record<string, number>, retryCount?: number): void;
  getDevice(endpointId: string): AuxDevice | undefined;
}
