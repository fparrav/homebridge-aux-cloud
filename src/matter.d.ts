import type { EndpointType, Logger } from 'homebridge';

declare module 'homebridge' {
  interface API {
    matter: MatterAPI;
    packageJSON: { version: string };
  }

  interface MatterAPI {
    uuid: {
      generate(identifier: string): string;
    };
    deviceTypes: Record<string, EndpointType>;
    registerPlatformAccessories(
      pluginName: string,
      platformName: string,
      accessories: unknown[],
    ): Promise<void>;
    unregisterPlatformAccessories(
      pluginName: string,
      platformName: string,
      accessories: unknown[],
    ): Promise<void>;
    updateAccessoryState(
      uuid: string,
      cluster: string,
      attributes: Record<string, unknown>,
      partId?: string,
    ): Promise<void>;
    getAccessoryState(
      uuid: string,
      cluster: string,
      partId?: string,
    ): Promise<Record<string, unknown> | undefined>;
    isMatterAvailable(): boolean;
    isMatterEnabled(): boolean;
  }

  interface MatterAccessory {
    UUID: string;
    displayName: string;
    deviceType: EndpointType;
    serialNumber: string;
    manufacturer: string;
    model: string;
    firmwareRevision: string;
    hardwareRevision: string;
    context?: Record<string, unknown>;
    clusters?: Record<string, Record<string, unknown>>;
    handlers?: Record<string, Record<string, (...args: unknown[]) => Promise<void>>>;
    parts?: unknown[];
  }

  interface MatterRequests {
    onOff: { onOff: number };
    fanControl: { fanMode: number; percentSetting: number; percentCurrent: number };
    temperatureControl: {
      occupiedHeatingSetpoint: number;
      occupiedCoolingSetpoint: number;
      externalMeasuredIndoorTemperature: number;
    };
    thermostat: { systemMode: number };
  }
}
