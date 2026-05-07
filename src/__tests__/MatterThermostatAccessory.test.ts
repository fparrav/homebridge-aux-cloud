import { MatterThermostatAccessory } from '../MatterThermostatAccessory';
import type { AuxDevice } from '../api/AuxCloudClient';
import type { AuxCloudPlatform } from '../platform';

// Minimal mock: only the fields accessed by toAccessory() and friends
function makePlatform(): AuxCloudPlatform {
  return {
    api: {
      matter: {
        uuid: { generate: (id: string) => `uuid-${id}` },
        deviceTypes: { Thermostat: 'Thermostat', OnOffSwitch: 'OnOffSwitch' },
      },
      packageJSON: { version: '0.0.0-test' },
    },
    log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
    featureSwitches: new Set(),
    commandTimeoutMs: 5000,
    commandRetryCount: 3,
    startDeviceCommand: jest.fn(),
    registerPendingCommand: jest.fn().mockReturnValue(1),
    completePendingCommand: jest.fn(),
  } as unknown as AuxCloudPlatform;
}

function makeDevice(overrides: Partial<AuxDevice> = {}): AuxDevice {
  return {
    endpointId: 'test-endpoint-01',
    friendlyName: 'Test AC',
    productId: '0000',
    devSession: '',
    devicetypeFlag: 0,
    cookie: '',
    params: {},
    state: 1,
    ...overrides,
  };
}

describe('MatterThermostatAccessory.toAccessory()', () => {
  let accessory: MatterThermostatAccessory;

  beforeEach(() => {
    accessory = new MatterThermostatAccessory(makePlatform(), makeDevice());
  });

  // ─── fanControl cluster ────────────────────────────────────────────────────

  test('fanModeSequence must not require AUT feature flag', () => {
    // Matter Spec § 4.4.6.2 — sequences that include Auto (ID 5) require [AUT].b:
    //   2 = OffLowMedHighAuto  ← INVALID without AUT
    //   3 = OffLowHighAuto     ← INVALID without AUT
    //   4 = OffHighAuto        ← INVALID without AUT
    // Valid without AUT:
    //   0 = OffLowMedHigh
    //   1 = OffLowHigh
    //   5 = OffHigh
    const AUT_SEQUENCES = [2, 3, 4];
    const config = accessory.toAccessory();
    const seq = (config.clusters as Record<string, Record<string, unknown>>).fanControl?.fanModeSequence as number;

    expect(AUT_SEQUENCES).not.toContain(seq);
  });

  test('fanControl cluster is present in toAccessory output', () => {
    const config = accessory.toAccessory();
    expect((config.clusters as Record<string, unknown>).fanControl).toBeDefined();
  });

  test('fanControl handlers are wired for fanModeChange and percentSettingChange', () => {
    const config = accessory.toAccessory();
    const handlers = (config.handlers as Record<string, Record<string, unknown>>).fanControl;
    expect(typeof handlers?.fanModeChange).toBe('function');
    expect(typeof handlers?.percentSettingChange).toBe('function');
  });

  // ─── onOff cluster must not be in thermostat (causes wrong device hierarchy) ──

  test('onOff cluster is NOT registered on thermostat (power via systemMode=0)', () => {
    const config = accessory.toAccessory();
    expect((config.clusters as Record<string, unknown>).onOff).toBeUndefined();
    expect((config.handlers as Record<string, unknown>).onOff).toBeUndefined();
  });

  // ─── systemMode reflects power state ─────────────────────────────────────

  test('systemMode is 0 (Off) when device power is 0', () => {
    const ac = new MatterThermostatAccessory(makePlatform(), makeDevice({ params: { pwr: 0 } }));
    const config = ac.toAccessory();
    const mode = (config.clusters as Record<string, Record<string, unknown>>).thermostat?.systemMode;
    expect(mode).toBe(0);
  });
});
