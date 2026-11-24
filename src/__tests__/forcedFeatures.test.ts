import type { API, CharacteristicValue, PlatformAccessory, PlatformConfig } from 'homebridge';

import type { AuxDevice } from '../api/AuxCloudClient';
import { AC_CLEAN, AC_MILDEW_PROOF, AC_SCREEN_DISPLAY } from '../api/constants';
import { AuxCloudHAPPlatform } from '../Platform.HAP';
import type { AuxCloudPlatform } from '../platform';
import { AuxCloudPlatformAccessory } from '../platformAccessory';
import { MatterThermostatAccessory } from '../MatterThermostatAccessory';
import type { AuxProvider, AuxProviderStateListener } from '../api/providers/AuxProvider';
import type { IAuxCloudPlatform } from '../types';

const FORCED_ENDPOINT = 'forced-ac';
const PLAIN_ENDPOINT = 'plain-ac';
const UNSUPPORTED_ENDPOINT = 'unsupported-ac';
const FORCED_MAC = '02:00:00:00:00:01';

const AC_PARAMS = { pwr: 1, temp: 240, mldprf: 0, ac_clean: 0, scrdisp: 0, ac_mode: 1 };

type SwitchHandler = (request: { onOff: number }) => Promise<void>;

function makeDevice(endpointId: string, params: Record<string, number>): AuxDevice {
  return {
    endpointId,
    friendlyName: `AC ${endpointId}`,
    productId: '000000000000000000000000c0620000',
    devSession: '',
    devicetypeFlag: 0,
    cookie: '',
    params,
    state: 1,
  };
}

class FakeProvider implements AuxProvider {
  public readonly kind = 'ac-freedom' as const;

  public readonly ensureLoggedIn = jest.fn().mockResolvedValue(undefined);

  public readonly listDevices = jest.fn().mockResolvedValue([]);

  public readonly setDeviceParams = jest.fn().mockResolvedValue(undefined);

  public readonly refreshDeviceParams = jest.fn().mockResolvedValue({});

  public readonly invalidateSession = jest.fn();

  public readonly close = jest.fn().mockResolvedValue(undefined);

  public readonly unsubscribe = jest.fn();

  private readonly listeners = new Set<AuxProviderStateListener>();

  public onStateChange(listener: AuxProviderStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

function makeHapPlatform(devices: PlatformConfig['devices']) {
  const provider = new FakeProvider();
  const log = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
    log: jest.fn(),
    prefix: '',
  };
  const api = {
    hap: {
      Service: {},
      Characteristic: {},
      uuid: { generate: (id: string) => `uuid-${id}` },
    },
    on: jest.fn(),
    isMatterAvailable: jest.fn(() => false),
    isMatterEnabled: jest.fn(() => false),
    platformAccessory: class FakePlatformAccessory {
      constructor(public displayName: string, public UUID: string) {}
    },
    registerPlatformAccessories: jest.fn(),
    unregisterPlatformAccessories: jest.fn(),
  } as unknown as API;
  const config = {
    platform: 'AuxCloudPlatform',
    name: 'Forced features test platform',
    username: 'test@example.test',
    password: 'test-password',
    devices,
  } as PlatformConfig;

  const platform = new AuxCloudHAPPlatform(log, config, api, { providerFactory: () => provider });
  return { log, platform, provider };
}

describe('forced features: platform', () => {
  test('matches a device by endpointId or by MAC', () => {
    const { platform } = makeHapPlatform([
      { endpointId: FORCED_ENDPOINT, forceMildewProof: true },
      { mac: FORCED_MAC, forceScreenDisplay: 'forceOff' },
      { endpointId: PLAIN_ENDPOINT },
    ]);

    expect(platform.getForcedFeatures(FORCED_ENDPOINT)?.mildewProof).toBe(true);
    expect(platform.getForcedFeatures('lan-020000000001', FORCED_MAC)?.screenDisplay).toBe('forceOff');
    expect(platform.getForcedFeatures(PLAIN_ENDPOINT)).toBeUndefined();
    expect(platform.getForcedFeatures('unknown-device', '02:00:00:00:00:02')).toBeUndefined();
  });

  test('injects the forced features into the power-off command', async () => {
    const { platform, provider } = makeHapPlatform([
      { endpointId: FORCED_ENDPOINT, forceMildewProof: true, forceClean: true },
    ]);

    await platform.sendDeviceParamsWithRetry(makeDevice(FORCED_ENDPOINT, AC_PARAMS), { pwr: 0 });

    expect(provider.setDeviceParams.mock.calls[0][1]).toEqual({ pwr: 0, mldprf: 1, ac_clean: 1 });
  });

  test('does not inject post-off features into commands that keep the unit on', async () => {
    const { platform, provider } = makeHapPlatform([
      { endpointId: FORCED_ENDPOINT, forceMildewProof: true, forceClean: true },
    ]);

    await platform.sendDeviceParamsWithRetry(makeDevice(FORCED_ENDPOINT, AC_PARAMS), { ac_mode: 1, temp: 250 });

    // Cloud commands always carry the current power state (existing behaviour).
    expect(provider.setDeviceParams.mock.calls[0][1]).toEqual({ pwr: 1, ac_mode: 1, temp: 250 });
  });

  test('screen display override is applied to every command', async () => {
    const { platform, provider } = makeHapPlatform([
      { endpointId: FORCED_ENDPOINT, forceScreenDisplay: 'forceOff' },
    ]);

    await platform.sendDeviceParamsWithRetry(makeDevice(FORCED_ENDPOINT, AC_PARAMS), { pwr: 1, temp: 250 });
    await platform.sendDeviceParamsWithRetry(makeDevice(FORCED_ENDPOINT, AC_PARAMS), { pwr: 0 });

    expect(provider.setDeviceParams.mock.calls[0][1]).toEqual({ pwr: 1, temp: 250, scrdisp: 0 });
    expect(provider.setDeviceParams.mock.calls[1][1]).toEqual({ pwr: 0, scrdisp: 0 });
  });

  test('screen display forceOn overrides an explicit off request', async () => {
    const { platform, provider } = makeHapPlatform([
      { endpointId: FORCED_ENDPOINT, forceScreenDisplay: 'forceOn' },
    ]);

    await platform.sendDeviceParamsWithRetry(makeDevice(FORCED_ENDPOINT, AC_PARAMS), { scrdisp: 0 });

    expect(provider.setDeviceParams.mock.calls[0][1]).toEqual({ pwr: 1, scrdisp: 1 });
  });

  test('leaves commands untouched for devices without the settings', async () => {
    const { platform, provider } = makeHapPlatform([{ endpointId: PLAIN_ENDPOINT }]);

    await platform.sendDeviceParamsWithRetry(makeDevice(PLAIN_ENDPOINT, AC_PARAMS), { pwr: 0 });

    expect(provider.setDeviceParams.mock.calls[0][1]).toEqual({ pwr: 0 });
  });

  test('warns once per unsupported parameter and does not inject it', async () => {
    const { log, platform, provider } = makeHapPlatform([
      { endpointId: UNSUPPORTED_ENDPOINT, forceMildewProof: true, forceScreenDisplay: 'forceOn' },
    ]);
    const device = makeDevice(UNSUPPORTED_ENDPOINT, { pwr: 1, temp: 210, ac_mode: 1 });

    await platform.sendDeviceParamsWithRetry(device, { pwr: 0 });
    await platform.sendDeviceParamsWithRetry(device, { pwr: 0 });

    expect(provider.setDeviceParams.mock.calls[0][1]).toEqual({ pwr: 0 });
    expect(log.warn.mock.calls.length).toBe(2);
    expect(String(log.warn.mock.calls[0][1])).toBe('forceMildewProof');
    expect(String(log.warn.mock.calls[1][1])).toBe('forceScreenDisplay');
  });
});

// ---------------------------------------------------------------------------
// HAP accessory
// ---------------------------------------------------------------------------

interface FakeCharacteristic {
  UUID: string;
  props: Record<string, unknown>;
  value: CharacteristicValue;
  setProps?: (props: Record<string, unknown>) => FakeCharacteristic;
  onSet?: (handler: (value: CharacteristicValue) => Promise<void> | void) => FakeCharacteristic;
  onGet?: (handler: () => CharacteristicValue) => FakeCharacteristic;
  setHandler?: (value: CharacteristicValue) => Promise<void> | void;
  getHandler?: () => CharacteristicValue;
}

class FakeService {
  characteristics: FakeCharacteristic[] = [];

  getCharacteristic(characteristic: string | { UUID: string }): FakeCharacteristic {
    const uuid = typeof characteristic === 'string' ? characteristic : characteristic.UUID;
    const existing = this.characteristics.find((candidate) => candidate.UUID === uuid);
    if (existing) {
      return existing;
    }
    const created: FakeCharacteristic = { UUID: uuid, props: {}, value: 0 };
    created.setProps = (props: Record<string, unknown>) => {
      created.props = props;
      return created;
    };
    created.onSet = (handler: (value: CharacteristicValue) => Promise<void> | void) => {
      created.setHandler = handler;
      return created;
    };
    created.onGet = (handler: () => CharacteristicValue) => {
      created.getHandler = handler;
      return created;
    };
    this.characteristics.push(created);
    return created;
  }

  addCharacteristic(characteristic: string | { UUID: string }): FakeCharacteristic {
    return this.getCharacteristic(characteristic);
  }

  setCharacteristic(characteristic: string | { UUID: string }, value: CharacteristicValue): FakeService {
    this.getCharacteristic(characteristic).value = value;
    return this;
  }

  updateCharacteristic(characteristic: string | { UUID: string }, value: CharacteristicValue): void {
    this.getCharacteristic(characteristic).value = value;
  }
}

function makeHapHarness(forcedFeatures: Record<string, unknown>, params: Record<string, number>) {
  const Service = {
    AccessoryInformation: { UUID: 'accessory-info' },
    HeaterCooler: { UUID: 'heater-cooler' },
    Switch: { UUID: 'switch' },
  } as unknown as AuxCloudHAPPlatform['Service'];
  const Characteristic = {
    Name: { UUID: 'name' },
    Manufacturer: { UUID: 'manufacturer' },
    Model: { UUID: 'model' },
    SerialNumber: { UUID: 'serial' },
    Active: { UUID: 'active', ACTIVE: 1, INACTIVE: 0 },
    TargetHeaterCoolerState: { UUID: 'target-state', AUTO: 0, COOL: 1, HEAT: 2 },
    CurrentHeaterCoolerState: { UUID: 'current-state', INACTIVE: 0, IDLE: 1, HEATING: 2, COOLING: 3 },
    CurrentTemperature: { UUID: 'current-temp' },
    HeatingThresholdTemperature: { UUID: 'heating-threshold' },
    CoolingThresholdTemperature: { UUID: 'cooling-threshold' },
    StatusFault: { UUID: 'fault', NO_FAULT: 0, GENERAL_FAULT: 1 },
    RotationSpeed: { UUID: 'rotation-speed' },
    SwingMode: { UUID: 'swing-mode', SWING_ENABLED: 0, SWING_DISABLED: 1 },
    TemperatureDisplayUnits: { UUID: 'temp-units', CELSIUS: 0, FAHRENHEIT: 1 },
    On: { UUID: 'on' },
  } as unknown as AuxCloudHAPPlatform['Characteristic'];

  const services = new Map<string, FakeService>();
  const accessory = {
    UUID: `uuid-${FORCED_ENDPOINT}`,
    displayName: 'Forced AC',
    context: {},
    getService: (service: { UUID: string }) => services.get(service.UUID) ?? null,
    getServiceById: (service: { UUID: string }, id: string) => services.get(`${service.UUID}:${id}`) ?? null,
    addService: (service: { UUID: string }, _name: string, id?: string) => {
      const created = new FakeService();
      services.set(`${service.UUID}:${id ?? service.UUID}`, created);
      return created;
    },
    removeService: (service: FakeService) => {
      for (const [key, value] of services.entries()) {
        if (value === service) {
          services.delete(key);
        }
      }
    },
  } as unknown as PlatformAccessory;

  const startDeviceCommand = jest.fn();
  const platform = {
    Service,
    Characteristic,
    log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    api: { hap: { uuid: { generate: (id: string) => `uuid-${id}` } } },
    temperatureUnit: 'C',
    temperatureStep: 0.5,
    featureSwitches: new Set<string>(),
    commandTimeoutMs: 5000,
    commandRetryCount: 2,
    getForcedFeatures: () => ({
      mildewProof: false,
      clean: false,
      screenDisplay: 'none',
      ...forcedFeatures,
    }),
    updateCachedDevice: jest.fn(),
    startDeviceCommand,
    registerPendingCommandWithState: jest.fn().mockReturnValue(1),
    schedulePendingCommandCompletion: jest.fn(),
  } as unknown as AuxCloudPlatform;

  const handler = new AuxCloudPlatformAccessory(platform, accessory);
  handler.updateAccessory(makeDevice(FORCED_ENDPOINT, params));

  return { accessory, handler, startDeviceCommand, services };
}

function switchOnCharacteristic(services: Map<string, FakeService>, key: string): FakeCharacteristic | undefined {
  return services.get(`switch:${key}`)?.characteristics.find((characteristic) => characteristic.UUID === 'on');
}

describe('forced features: HAP accessory', () => {
  test('exposes the Mildew Proof switch as on when forced', () => {
    const { services } = makeHapHarness({ mildewProof: true }, AC_PARAMS);
    const on = switchOnCharacteristic(services, 'mildewProof');

    expect(on).toBeDefined();
    expect(on!.value).toBe(true);
    expect(on!.getHandler!()).toBe(true);
  });

  test('ignores an Off request while Mildew Proof is forced', () => {
    const { services, startDeviceCommand } = makeHapHarness({ mildewProof: true }, AC_PARAMS);
    const on = switchOnCharacteristic(services, 'mildewProof')!;

    on.setHandler!(false);

    expect(startDeviceCommand.mock.calls[0][1]).toEqual({ mldprf: 1 });
    expect(on.value).toBe(true);
  });

  test('reports Screen Display off when forceScreenDisplay is forceOff', () => {
    const { services, startDeviceCommand } = makeHapHarness({ screenDisplay: 'forceOff' }, AC_PARAMS);
    const on = switchOnCharacteristic(services, 'screenDisplay')!;

    expect(on.getHandler!()).toBe(false);

    on.setHandler!(true);

    expect(startDeviceCommand.mock.calls[0][1]).toEqual({ scrdisp: 0 });
    expect(on.value).toBe(false);
  });

  test('keeps Screen Display on when forceScreenDisplay is forceOn', () => {
    const { services, startDeviceCommand } = makeHapHarness({ screenDisplay: 'forceOn' }, AC_PARAMS);
    const on = switchOnCharacteristic(services, 'screenDisplay')!;

    expect(on.getHandler!()).toBe(true);

    on.setHandler!(false);

    expect(startDeviceCommand.mock.calls[0][1]).toEqual({ scrdisp: 1 });
  });

  test('does not expose a switch for a device without forced features', () => {
    const { services } = makeHapHarness({}, AC_PARAMS);

    expect(switchOnCharacteristic(services, 'mildewProof')).toBeUndefined();
    expect(switchOnCharacteristic(services, 'screenDisplay')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Matter accessory
// ---------------------------------------------------------------------------

function makeMatterHarness(forcedFeatures: Record<string, unknown>, params: Record<string, number>) {
  const startDeviceCommand = jest.fn();
  const platform = {
    api: {
      matter: {
        uuid: { generate: (id: string) => `uuid-${id}` },
        deviceTypes: { Thermostat: 'Thermostat', OnOffSwitch: 'OnOffSwitch' },
      },
      packageJSON: { version: '0.0.0-test' },
    },
    log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
    featureSwitches: new Set<string>(),
    commandTimeoutMs: 5000,
    commandRetryCount: 3,
    redactDeviceIdentifiers: false,
    getForcedFeatures: () => ({
      mildewProof: false,
      clean: false,
      screenDisplay: 'none',
      ...forcedFeatures,
    }),
    startDeviceCommand,
    registerPendingCommand: jest.fn().mockReturnValue(1),
    schedulePendingCommandCompletion: jest.fn(),
    isStaleState: () => false,
  } as unknown as IAuxCloudPlatform;

  return {
    accessory: new MatterThermostatAccessory(platform, makeDevice(FORCED_ENDPOINT, params)),
    startDeviceCommand,
  };
}

function switchOnOff(switchConfig: Record<string, unknown>): number | undefined {
  const clusters = switchConfig.clusters as Record<string, Record<string, number>> | undefined;
  return clusters?.onOff?.onOff;
}

describe('forced features: Matter accessory', () => {
  test('registers the forced switches with the forced state', () => {
    const { accessory } = makeMatterHarness({ mildewProof: true, screenDisplay: 'forceOff' }, AC_PARAMS);
    const switches = accessory.getMatterSwitchAccessories();

    const mildew = switches.find((config) => config.displayName === 'Mildew Proof');
    const display = switches.find((config) => config.displayName === 'Screen Display');

    expect(switchOnOff(mildew!)).toBe(1);
    expect(switchOnOff(display!)).toBe(0);
  });

  test('an Off request on a forced switch sends the forced payload', async () => {
    const { accessory, startDeviceCommand } = makeMatterHarness({ mildewProof: true }, AC_PARAMS);
    const switches = accessory.getMatterSwitchAccessories();
    const mildew = switches.find((config) => config.displayName === 'Mildew Proof');
    const handlers = mildew!.handlers as Record<string, Record<string, SwitchHandler>>;

    await handlers.onOff.onOffSet({ onOff: 0 });

    expect(startDeviceCommand.mock.calls[0][1]).toEqual({ mldprf: 1 });
  });

  test('does not register switches for a device without forced features', () => {
    const { accessory } = makeMatterHarness({}, AC_PARAMS);

    expect(accessory.getMatterSwitchAccessories().length).toBe(0);
  });

  test('ignores an Off request on a forced switch and leaves the other switches alone', async () => {
    const { accessory, startDeviceCommand } = makeMatterHarness({ clean: true }, AC_PARAMS);
    const switches = accessory.getMatterSwitchAccessories();
    const mildew = switches.find((config) => config.displayName === 'Mildew Proof');

    expect(mildew).toBeUndefined();
    expect(switches.length).toBe(1);

    const handlers = (switches[0].handlers as Record<string, Record<string, SwitchHandler>>).onOff;
    await handlers.onOffSet({ onOff: 0 });

    expect(startDeviceCommand.mock.calls[0][1]).toEqual({ [AC_CLEAN]: 1 });
    expect(startDeviceCommand.mock.calls[0][1]).not.toHaveProperty(AC_MILDEW_PROOF);
    expect(startDeviceCommand.mock.calls[0][1]).not.toHaveProperty(AC_SCREEN_DISPLAY);
  });
});
