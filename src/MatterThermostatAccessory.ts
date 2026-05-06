/**
 * Matter Thermostat Accessory for AUX Air Conditioner
 *
 * Maps AUX AC functionality to Matter Spec § 9.1 (Thermostat) + § 9.2 (Fan).
 * Feature switches (screen display, mildew proof, etc.) are exposed as On/Off Switches (§ 6.1).
 */

import type { API, Logger } from 'homebridge';

import {
  AC_CLEAN,
  AC_CLEAN_OFF,
  AC_CLEAN_ON,
  AC_FAN_SPEED,
  AC_HEALTH,
  AC_HEALTH_OFF,
  AC_HEALTH_ON,
  AC_MILDEW_PROOF,
  AC_MILDEW_PROOF_OFF,
  AC_MILDEW_PROOF_ON,
  AC_POWER,
  AC_POWER_OFF,
  AC_POWER_ON,
  AC_SLEEP,
  AC_SLEEP_OFF,
  AC_SLEEP_ON,
  AC_SCREEN_DISPLAY,
  AC_SCREEN_DISPLAY_OFF,
  AC_SCREEN_DISPLAY_ON,
  AC_TEMPERATURE_AMBIENT,
  AC_TEMPERATURE_TARGET,
  AUX_ECOMODE,
  AUX_MODE,
  AuxAcModeValue,
  AuxFanSpeed,
  AuxProducts,
} from './api/constants';
import type { AuxCloudPlatform, FeatureSwitchKey } from './platform';
import type { AuxDevice } from './api/AuxCloudClient';

// Matter accessory configuration type (returned by toAccessory())
type MatterHandlerCallback =
  | ((request: { onOff: number }) => Promise<void>)
  | ((request: { fanMode: number; oldFanMode: number }) => Promise<void>)
  | ((request: { percentSetting: number; oldPercentSetting: number }) => Promise<void>)
  | ((request: { occupiedHeatingSetpoint: number }) => Promise<void>)
  | ((request: { occupiedCoolingSetpoint: number }) => Promise<void>)
  | ((request: { systemMode: number }) => Promise<void>);

interface MatterAccessoryConfig {
   [key: string]: unknown;
  UUID: string;
  displayName: string;
  deviceType: string;
  serialNumber: string;
  manufacturer: string;
  model: string;
  firmwareRevision: string;
  hardwareRevision: string;
  clusters: Record<string, Record<string, unknown>>;
  handlers: Record<string, Record<string, MatterHandlerCallback>>;
  parts?: unknown[];
  context?: Record<string, unknown>;
}

// Matter cluster constant mappings (per Matter Spec § 9.1)
const THERMOSTAT_MODE_AUTO = 1;
// 2 = Reserved
const THERMOSTAT_MODE_COOL = 3;
const THERMOSTAT_MODE_HEAT = 4;
// 5 = Emergency Heat (not applicable for AC)
const THERMOSTAT_MODE_DRY = 6; // 6 = Precooling / dehumidification → Dry
const THERMOSTAT_MODE_FAN_ONLY = 7; // 7 = Fan Only

export class MatterThermostatAccessory {
  private readonly api: API;
  private readonly log: Logger;
  private readonly platform: AuxCloudPlatform;
  private device?: AuxDevice;
  private readonly endpointId: string;

  constructor(
    platform: AuxCloudPlatform,
    device: AuxDevice,
  ) {
    this.api = platform.api;
    this.log = platform.log;
    this.platform = platform;
    this.device = device;
    this.endpointId = device.endpointId;

    this.log.info(`[Matter] Initialized Thermostat for "${device.friendlyName}" (${this.endpointId})`);
  }

  /**
   * Convert this accessory to a MatterAccessory object for registration.
   */
  toAccessory(): MatterAccessoryConfig {
    const displayName = this.device?.friendlyName ?? 'AUX AC';
    const productId = this.device?.productId;
    const deviceName = AuxProducts.getDeviceName(productId) ?? 'AUX Air Conditioner';

    return {
      UUID: this.api.matter.uuid.generate(`matter-thermostat-${this.endpointId}`),
      displayName,
      deviceType: this.api.matter.deviceTypes.Thermostat,
      serialNumber: this.endpointId,
      manufacturer: 'AUX',
      model: deviceName,
      firmwareRevision: this.api.packageJSON?.version ?? '1.0.0',
      hardwareRevision: '1.0.0',
      clusters: {
        onOff: {
          onOff: this.getMatterOnOffState(),
        },
        fanControl: {
          fanMode: this.getMatterFanMode(),
          percentSetting: this.getMatterFanPercent(),
          percentCurrent: this.getMatterFanPercent(),
          fanModeSequence: 2,  // Off/Low/Med/High/Auto
         },
        temperatureControl: {
          occupiedHeatingSetpoint: this.getMatterHeatingSetpoint(),
          occupiedCoolingSetpoint: this.getMatterCoolingSetpoint(),
          externalMeasuredIndoorTemperature: this.getMatterCurrentTemp(),
        },
        thermostat: {
          systemMode: this.getMatterSystemMode(),
          externalMeasuredOccupancy: false,
          minHeatSetpointLimit: 700, // 7.00°C
          maxHeatSetpointLimit: 3000, // 30.00°C
          minCoolSetpointLimit: 1600, // 16.00°C
          maxCoolSetpointLimit: 3200, // 32.00°C
          minSetpointDeadBand: 25, // 2.5°C
          controlSequenceOfOperation: 4, // cooling and heating
        },
      },
      handlers: {
        onOff: {
          onOffToggle: async () => this.handleOnOffToggle(),
          onOffSet: async (request: { onOff: number }) => this.handleOnOffSet(request),
        },
        fanControl: {
          fanModeChange: async (request: { fanMode: number; oldFanMode: number }) => this.handleFanModeChange(request),
          percentSettingChange: async (request: { percentSetting: number; oldPercentSetting: number }) => this.handlePercentSettingChange(request),
         },
        temperatureControl: {
          occupiedHeatingSetpointChange: async (request: { occupiedHeatingSetpoint: number }) => this.handleHeatingSetpointChange(request),
          occupiedCoolingSetpointChange: async (request: { occupiedCoolingSetpoint: number }) => this.handleCoolingSetpointChange(request),
        },
        thermostat: {
          systemModeChange: async (request: { systemMode: number }) => this.handleSystemModeChange(request),
        },
      },
    } as MatterAccessoryConfig;
  }

  // ─────────────────────────────────────────────
  // Matter handler implementations
  // ─────────────────────────────────────────────

  private async handleOnOffSet(request: { onOff: number }): Promise<void> {
    if (!this.device) return;
    const power = request.onOff === 1 ? AC_POWER_ON : AC_POWER_OFF;
    this.log.info(`[Matter][${this.device.friendlyName}] Power: ${request.onOff === 1 ? 'ON' : 'OFF'}`);
    await this.sendCommand(power);
   }

   private async handleOnOffToggle(): Promise<void> {
    if (!this.device) return;
    const isOn = this.getMatterOnOffState() === 1;
    const power = isOn ? AC_POWER_OFF : AC_POWER_ON;
    this.log.info(`[Matter][${this.device.friendlyName}] Power toggle: ${power === AC_POWER_ON ? 'ON' : 'OFF'}`);
    await this.sendCommand(power);
   }

  private async handleFanModeChange(request: { fanMode: number; oldFanMode: number }): Promise<void> {
    if (!this.device) return;
    const modeNames = ['Off', 'Low', 'Medium', 'High', 'On', 'Auto', 'Smart'];
    const modeName = modeNames[request.fanMode] ?? `Unknown (${request.fanMode})`;
    this.log.info(`[Matter][${this.device.friendlyName}] Fan mode: ${modeName} (${request.fanMode})`);

    // Map Matter fanMode to AuxFanSpeed
    let speed: AuxFanSpeed;
    switch (request.fanMode) {
      case 0: // Off
        speed = AuxFanSpeed.MUTE;
        break;
      case 1: // Low
        speed = AuxFanSpeed.LOW;
        break;
      case 2: // Medium
        speed = AuxFanSpeed.MEDIUM;
        break;
      case 3: // High
        speed = AuxFanSpeed.HIGH;
        break;
      case 5: // Auto
        speed = AuxFanSpeed.AUTO;
        break;
      case 4: // On (no speed info) → default to auto
      case 6: // Smart → default to auto
      default:
        speed = AuxFanSpeed.AUTO;
        break;
    }
    await this.sendCommand({ [AC_FAN_SPEED]: speed });
  }

  private async handlePercentSettingChange(request: { percentSetting: number; oldPercentSetting: number }): Promise<void> {
    if (!this.device) return;
    const percent = request.percentSetting ?? 0;
    const isOff = percent === 0;
    const wasOff = (request.oldPercentSetting ?? 0) === 0;

       // Detect on/off transition first (percentSetting is used for both on/off and speed)
    if (isOff !== wasOff) {
      this.log.info(`[Matter][${this.device.friendlyName}] Fan power: ${isOff ? 'OFF' : 'ON'}`);
      const speed = isOff ? AuxFanSpeed.MUTE : AuxFanSpeed.AUTO;
      await this.sendCommand({ [AC_FAN_SPEED]: speed });
       }

       // Update speed only when not turning off
    if (!isOff) {
      this.log.info(`[Matter][${this.device.friendlyName}] Fan speed: ${percent}%`);
      let speed: AuxFanSpeed;
      if (percent <= 25) {
        speed = AuxFanSpeed.LOW;
         } else if (percent <= 50) {
        speed = AuxFanSpeed.MEDIUM;
         } else if (percent <= 75) {
        speed = AuxFanSpeed.HIGH;
         } else {
        speed = AuxFanSpeed.TURBO;
         }
      await this.sendCommand({ [AC_FAN_SPEED]: speed });
        }
      }


  private async handleHeatingSetpointChange(request: { occupiedHeatingSetpoint: number }): Promise<void> {
    if (!this.device) return;
    const celsius = request.occupiedHeatingSetpoint / 100;
    this.log.info(`[Matter][${this.device.friendlyName}] Heating setpoint: ${celsius}°C`);
    await this.sendCommand({ [AC_TEMPERATURE_TARGET]: Math.round(celsius * 10) });
    // Ensure mode is HEAT
    await this.sendCommand({ [AUX_MODE]: AuxAcModeValue.HEATING });
  }

  private async handleCoolingSetpointChange(request: { occupiedCoolingSetpoint: number }): Promise<void> {
    if (!this.device) return;
    const celsius = request.occupiedCoolingSetpoint / 100;
    this.log.info(`[Matter][${this.device.friendlyName}] Cooling setpoint: ${celsius}°C`);
    await this.sendCommand({ [AC_TEMPERATURE_TARGET]: Math.round(celsius * 10) });
    // Ensure mode is COOL
    await this.sendCommand({ [AUX_MODE]: AuxAcModeValue.COOLING });
  }

  private async handleSystemModeChange(request: { systemMode: number }): Promise<void> {
    if (!this.device) return;
    const modeNames = ['Off', 'Auto', 'Reserved', 'Cool', 'Heat', 'Emergency Heat', 'Precooling', 'Fan Only'];
    const modeName = modeNames[request.systemMode] ?? `Unknown (${request.systemMode})`;
    this.log.info(`[Matter][${this.device.friendlyName}] System mode: ${modeName} (${request.systemMode})`);

    let auxMode: AuxAcModeValue;
    switch (request.systemMode) {
      case THERMOSTAT_MODE_COOL:
        auxMode = AuxAcModeValue.COOLING;
        break;
      case THERMOSTAT_MODE_HEAT:
        auxMode = AuxAcModeValue.HEATING;
        break;
      case THERMOSTAT_MODE_DRY:
         // 6 = Precooling in Matter → map to Dry for dehumidification
        auxMode = AuxAcModeValue.DRY;
        break;
      case THERMOSTAT_MODE_FAN_ONLY:
         // 7 = Fan Only
        auxMode = AuxAcModeValue.FAN;
        break;
      case THERMOSTAT_MODE_AUTO:
      default:
        auxMode = AuxAcModeValue.AUTO;
        break;
    }
    await this.sendCommand({ [AUX_MODE]: auxMode });
  }

  // ─────────────────────────────────────────────
  // Getters: translate AUX params → Matter values
  // ─────────────────────────────────────────────

  private getMatterOnOffState(): number {
    if (!this.device) return 0;
    const powerParam = this.device.params?.[AC_POWER];
    if (powerParam === 1) return 1;
    if (powerParam === 0) return 0;
    return this.device.state === 1 ? 1 : 0;
  }

  private getMatterFanMode(): number {
    if (!this.device) return 5; // Auto = default
    const fan = this.device.params?.[AC_FAN_SPEED];
    if (fan === undefined) return 5; // auto
    switch (fan) {
      case AuxFanSpeed.MUTE: return 0; // Off
      case AuxFanSpeed.LOW: return 1; // Low
      case AuxFanSpeed.MEDIUM: return 2; // Medium
      case AuxFanSpeed.HIGH: return 3; // High
      case AuxFanSpeed.TURBO: return 3; // High (closest to Turbo)
      default: return 5; // Auto
    }
  }

  private getMatterFanPercent(): number {
    if (!this.device) return 50;
    const fan = this.device.params?.[AC_FAN_SPEED];
    if (fan === undefined) return 50; // auto
    switch (fan) {
      case AuxFanSpeed.MUTE: return 0;
      case AuxFanSpeed.LOW: return 25;
      case AuxFanSpeed.MEDIUM: return 50;
      case AuxFanSpeed.HIGH: return 75;
      case AuxFanSpeed.TURBO: return 100;
      default: return 50; // auto
    }
  }


  private getMatterHeatingSetpoint(): number {
    if (!this.device) return 2000;
    const target = this.device.params?.[AC_TEMPERATURE_TARGET];
    if (target === undefined) return 2000;
    return Math.round((target / 10) * 100);
  }

  private getMatterCoolingSetpoint(): number {
    if (!this.device) return 2400;
    const target = this.device.params?.[AC_TEMPERATURE_TARGET];
    if (target === undefined) return 2400;
    return Math.round((target / 10) * 100);
  }

  private getMatterCurrentTemp(): number {
    if (!this.device) return 2100;
    const ambient = this.device.params?.[AC_TEMPERATURE_AMBIENT];
    if (ambient === undefined) return 2100;
    return Math.round((ambient / 10) * 100);
  }

  private getMatterSystemMode(): number {
    if (!this.device) return THERMOSTAT_MODE_AUTO;
    const auxMode = this.device.params?.[AUX_MODE];
    if (auxMode === undefined) return THERMOSTAT_MODE_AUTO;
    switch (auxMode) {
      case AuxAcModeValue.COOLING: return THERMOSTAT_MODE_COOL;
      case AuxAcModeValue.HEATING: return THERMOSTAT_MODE_HEAT;
      case AuxAcModeValue.DRY: return THERMOSTAT_MODE_DRY;
      case AuxAcModeValue.FAN: return THERMOSTAT_MODE_FAN_ONLY;
      case AuxAcModeValue.AUTO:
      default: return THERMOSTAT_MODE_AUTO;
    }
  }

  // ─────────────────────────────────────────────
  // Feature switches → On/Off Switch accessories
  // ─────────────────────────────────────────────

  getMatterSwitchAccessories(): Array<Record<string, unknown>> {
    if (!this.device) return [];
    const switches: Array<Record<string, unknown>> = [];
    const featureSwitches = this.platform.featureSwitches;

    const mappings: Array<{
      key: string;
      label: string;
      param: string;
      onPayload: Record<string, number>;
      offPayload: Record<string, number>;
    }> = [
      { key: 'screenDisplay', label: 'Screen Display', param: AC_SCREEN_DISPLAY, onPayload: AC_SCREEN_DISPLAY_ON, offPayload: AC_SCREEN_DISPLAY_OFF },
      { key: 'mildewProof', label: 'Mildew Proof', param: AC_MILDEW_PROOF, onPayload: AC_MILDEW_PROOF_ON, offPayload: AC_MILDEW_PROOF_OFF },
      { key: 'clean', label: 'Self Clean', param: AC_CLEAN, onPayload: AC_CLEAN_ON, offPayload: AC_CLEAN_OFF },
      { key: 'health', label: 'Health Mode', param: AC_HEALTH, onPayload: AC_HEALTH_ON, offPayload: AC_HEALTH_OFF },
      { key: 'sleep', label: 'Sleep Mode', param: AC_SLEEP, onPayload: AC_SLEEP_ON, offPayload: AC_SLEEP_OFF },
      { key: 'eco', label: 'Eco Mode', param: AUX_ECOMODE, onPayload: { [AUX_ECOMODE]: 1 }, offPayload: { [AUX_ECOMODE]: 0 } },
    ];

    for (const m of mappings) {
      if (!featureSwitches.has(m.key as FeatureSwitchKey)) continue;
      const supported = typeof this.device?.params?.[m.param] === 'number';
      if (!supported) continue;

      const uuid = this.api.matter.uuid.generate(`matter-switch-${this.endpointId}-${m.key}`);
      switches.push({
        UUID: uuid,
        displayName: `${this.device.friendlyName} — ${m.label}`,
        deviceType: this.api.matter.deviceTypes.OnOffSwitch,
        serialNumber: `${this.endpointId}-${m.key}`,
        manufacturer: 'AUX',
        model: `${AuxProducts.getDeviceName(this.device.productId) ?? 'AUX'} ${m.label}`,
        firmwareRevision: this.api.packageJSON?.version ?? '1.0.0',
        hardwareRevision: '1.0.0',
        clusters: {
          onOff: {
            onOff: this.getSwitchState(m.param),
          },
        },
        handlers: {
          onOff: {
            onOffSet: async (request: { onOff: number }) => this.handleSwitchSet(m.key, m.onPayload, m.offPayload, request),
          },
        },
      } as MatterAccessoryConfig);
    }

    return switches;
  }

  private getSwitchState(param: string): number {
    if (!this.device) return 0;
    const val = this.device.params?.[param];
    return val === 1 ? 1 : 0;
  }

  private async handleSwitchSet(
    key: string,
    onPayload: Record<string, number>,
    offPayload: Record<string, number>,
    request: { onOff: number },
  ): Promise<void> {
    if (!this.device) return;
    const payload = request.onOff === 1 ? onPayload : offPayload;
    this.log.info(`[Matter][${this.device.friendlyName}] Switch ${key}: ${request.onOff === 1 ? 'ON' : 'OFF'}`);
    await this.sendCommand(payload);
  }

  // ─────────────────────────────────────────────
  // Command dispatch
  // ─────────────────────────────────────────────

  private async sendCommand(payload: Record<string, number>): Promise<void> {
    if (!this.device) return;
    try {
      this.platform.startDeviceCommand(this.device, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.error(`[Matter][${this.device.friendlyName}] Failed to send command: ${message}`);
    }
  }

  // ─────────────────────────────────────────────
  // State refresh — called on each poll cycle
  // ─────────────────────────────────────────────

  async refresh(): Promise<void> {
    if (!this.device) return;
    try {
      const updated = this.platform.getDevice(this.endpointId);
      if (updated) {
        this.device = updated;
        // Update Matter state
        await this.api.matter.updateAccessoryState(
          this.toAccessory().UUID,
          'onOff',
          { onOff: this.getMatterOnOffState() },
        );
        await this.api.matter.updateAccessoryState(
          this.toAccessory().UUID,
          'fanControl',
          {
            fanMode: this.getMatterFanMode(),
            percentSetting: this.getMatterFanPercent(),
            percentCurrent: this.getMatterFanPercent(),
          },
        );
        await this.api.matter.updateAccessoryState(
          this.toAccessory().UUID,
          'temperatureControl',
          {
            occupiedHeatingSetpoint: this.getMatterHeatingSetpoint(),
            occupiedCoolingSetpoint: this.getMatterCoolingSetpoint(),
            externalMeasuredIndoorTemperature: this.getMatterCurrentTemp(),
          },
        );
        await this.api.matter.updateAccessoryState(
          this.toAccessory().UUID,
          'thermostat',
          {
            systemMode: this.getMatterSystemMode(),
          },
        );

        // Update switch states
        const switchAccessories = this.getMatterSwitchAccessories();
        for (const sw of switchAccessories) {
          const uuid = sw.UUID as string;
          const clusters = sw.clusters as Record<string, Record<string, unknown>>;
          const onOff = clusters?.onOff?.onOff as number;
          if (uuid && onOff !== undefined) {
            await this.api.matter.updateAccessoryState(uuid, 'onOff', { onOff });
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.debug(`[Matter][${this.device.friendlyName}] Refresh error: ${message}`);
    }
  }

  getDevice(): AuxDevice | undefined {
    return this.device;
  }
}
