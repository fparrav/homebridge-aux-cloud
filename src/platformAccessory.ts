import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import {
  AC_CHILD_LOCK,
  AC_CHILD_LOCK_OFF,
  AC_CHILD_LOCK_ON,
  AC_FAN_SPEED,
  AC_POWER,
  AC_POWER_OFF,
  AC_POWER_ON,
  AC_SWING_HORIZONTAL,
  AC_SWING_HORIZONTAL_OFF,
  AC_SWING_HORIZONTAL_ON,
  AC_SWING_VERTICAL,
  AC_SWING_VERTICAL_OFF,
  AC_SWING_VERTICAL_ON,
  AC_TEMPERATURE_AMBIENT,
  AC_TEMPERATURE_TARGET,
  AuxAcModeValue,
  AuxFanSpeed,
  AuxProducts,
  AUX_MODE,
} from './api/constants';
import type { AuxDevice } from './api/AuxCloudClient';
import type { AuxCloudPlatform } from './platform';

interface AuxCloudAccessoryContext {
  device?: {
    endpointId: string;
    productId?: string;
    friendlyName?: string;
  };
}

const MIN_TARGET_TEMPERATURE_C = 16;
const MAX_TARGET_TEMPERATURE_C = 30;
const DEFAULT_TEMPERATURE_C = 24;
const CURRENT_TEMPERATURE_MIN_C = -40;
const CURRENT_TEMPERATURE_MAX_C = 60;

const FAN_SPEED_LEVELS: Array<{ aux: AuxFanSpeed; percent: number }> = [
  { aux: AuxFanSpeed.AUTO, percent: 0 },
  { aux: AuxFanSpeed.MUTE, percent: 10 },
  { aux: AuxFanSpeed.LOW, percent: 30 },
  { aux: AuxFanSpeed.MEDIUM, percent: 50 },
  { aux: AuxFanSpeed.HIGH, percent: 75 },
  { aux: AuxFanSpeed.TURBO, percent: 100 },
];

const roundToOneDecimal = (value: number): number => Math.round(value * 10) / 10;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const celsiusToDisplay = (celsius: number, unit: 'C' | 'F'): number =>
  roundToOneDecimal(unit === 'F' ? (celsius * 9) / 5 + 32 : celsius);

const displayToCelsius = (value: number, unit: 'C' | 'F'): number =>
  unit === 'F' ? ((value - 32) * 5) / 9 : value;

export class AuxCloudPlatformAccessory {
  private readonly service: Service;

  private readonly temperatureUnit: 'C' | 'F';

  private readonly temperatureStep: number;

  private readonly minTargetDisplay: number;

  private readonly maxTargetDisplay: number;

  private readonly defaultTargetDisplay: number;

  private readonly temperatureDisplayUnitsValue: number;

  private device?: AuxDevice;

  private supportsFanSpeed = false;

  private supportsSwingVertical = false;

  private supportsSwingHorizontal = false;

  private supportsChildLock = false;

  private fanHandlersConfigured = false;

  private swingHandlersConfigured = false;

  private lockHandlersConfigured = false;

  constructor(
    private readonly platform: AuxCloudPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.temperatureUnit = platform.temperatureUnit;
    this.temperatureStep = platform.temperatureStep;

    this.minTargetDisplay = this.roundToStep(celsiusToDisplay(MIN_TARGET_TEMPERATURE_C, this.temperatureUnit));
    this.maxTargetDisplay = this.roundToStep(celsiusToDisplay(MAX_TARGET_TEMPERATURE_C, this.temperatureUnit));
    this.defaultTargetDisplay = this.roundToStep(celsiusToDisplay(DEFAULT_TEMPERATURE_C, this.temperatureUnit));

    this.temperatureDisplayUnitsValue = this.temperatureUnit === 'F'
      ? this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT
      : this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS;

    const infoService = this.accessory.getService(this.platform.Service.AccessoryInformation)
      ?? this.accessory.addService(this.platform.Service.AccessoryInformation);

    infoService
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'AUX')
      .setCharacteristic(this.platform.Characteristic.Model, 'AUX Cloud Device')
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        this.getContext().device?.endpointId ?? 'unknown',
      );

    this.service = this.accessory.getService(this.platform.Service.HeaterCooler)
      ?? this.accessory.addService(this.platform.Service.HeaterCooler);

    this.service.setCharacteristic(this.platform.Characteristic.Name, this.accessory.displayName);

    this.configureCharacteristics();
  }

  updateAccessory(device: AuxDevice): void {
    this.device = device;
    this.platform.updateCachedDevice(device);

    const context = this.getContext();
    context.device = {
      endpointId: device.endpointId,
      productId: device.productId,
      friendlyName: device.friendlyName,
    };
    this.accessory.context = context;

    const accessoryInfo = this.accessory.getService(this.platform.Service.AccessoryInformation);
    accessoryInfo?.updateCharacteristic(
      this.platform.Characteristic.Model,
      AuxProducts.getDeviceName(device.productId),
    );
    accessoryInfo?.updateCharacteristic(
      this.platform.Characteristic.SerialNumber,
      device.endpointId,
    );

    this.service.updateCharacteristic(this.platform.Characteristic.Name, device.friendlyName);

    this.supportsFanSpeed = typeof device.params[AC_FAN_SPEED] === 'number';
    this.supportsSwingVertical = typeof device.params[AC_SWING_VERTICAL] === 'number';
    this.supportsSwingHorizontal = typeof device.params[AC_SWING_HORIZONTAL] === 'number';
    this.supportsChildLock = typeof device.params[AC_CHILD_LOCK] === 'number';

    this.configureOptionalCharacteristics();
    this.updateCharacteristicsFromDevice();
  }

  private configureCharacteristics(): void {
    const {
      Active,
      TargetHeaterCoolerState,
      CurrentHeaterCoolerState,
      CurrentTemperature,
      HeatingThresholdTemperature,
      CoolingThresholdTemperature,
      TemperatureDisplayUnits,
    } = this.platform.Characteristic;

    this.service.getCharacteristic(Active)
      .onSet(this.handleActiveSet.bind(this))
      .onGet(this.handleActiveGet.bind(this));

    this.service.getCharacteristic(TargetHeaterCoolerState)
      .setProps({
        validValues: [
          TargetHeaterCoolerState.AUTO,
          TargetHeaterCoolerState.COOL,
          TargetHeaterCoolerState.HEAT,
        ],
      })
      .onSet(this.handleTargetStateSet.bind(this))
      .onGet(this.handleTargetStateGet.bind(this));

    this.service.getCharacteristic(CurrentHeaterCoolerState)
      .onGet(this.handleCurrentHeaterCoolerStateGet.bind(this));

    const currentTemperatureMin = celsiusToDisplay(CURRENT_TEMPERATURE_MIN_C, this.temperatureUnit);
    const currentTemperatureMax = celsiusToDisplay(CURRENT_TEMPERATURE_MAX_C, this.temperatureUnit);

    this.service.getCharacteristic(CurrentTemperature)
      .setProps({
        minValue: Math.min(currentTemperatureMin, currentTemperatureMax),
        maxValue: Math.max(currentTemperatureMin, currentTemperatureMax),
        minStep: 0.1,
      })
      .onGet(this.handleCurrentTemperatureGet.bind(this));

    this.service.getCharacteristic(HeatingThresholdTemperature)
      .setProps({
        minValue: this.minTargetDisplay,
        maxValue: this.maxTargetDisplay,
        minStep: this.temperatureStep,
      })
      .onSet(this.handleTargetTemperatureSet.bind(this))
      .onGet(this.handleTargetTemperatureGet.bind(this));

    this.service.getCharacteristic(CoolingThresholdTemperature)
      .setProps({
        minValue: this.minTargetDisplay,
        maxValue: this.maxTargetDisplay,
        minStep: this.temperatureStep,
      })
      .onSet(this.handleTargetTemperatureSet.bind(this))
      .onGet(this.handleTargetTemperatureGet.bind(this));

    this.service.updateCharacteristic(TemperatureDisplayUnits, this.temperatureDisplayUnitsValue);
  }

  private configureOptionalCharacteristics(): void {
    const { RotationSpeed, SwingMode, LockPhysicalControls } = this.platform.Characteristic;

    if (this.supportsFanSpeed && !this.fanHandlersConfigured) {
      this.service.getCharacteristic(RotationSpeed)
        .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
        .onSet(this.handleRotationSpeedSet.bind(this))
        .onGet(this.handleRotationSpeedGet.bind(this));
      this.fanHandlersConfigured = true;
    }

    if ((this.supportsSwingVertical || this.supportsSwingHorizontal) && !this.swingHandlersConfigured) {
      this.service.getCharacteristic(SwingMode)
        .onSet(this.handleSwingModeSet.bind(this))
        .onGet(this.handleSwingModeGet.bind(this));
      this.swingHandlersConfigured = true;
    }

    if (this.supportsChildLock && !this.lockHandlersConfigured) {
      this.service.getCharacteristic(LockPhysicalControls)
        .onSet(this.handleLockPhysicalControlsSet.bind(this))
        .onGet(this.handleLockPhysicalControlsGet.bind(this));
      this.lockHandlersConfigured = true;
    }
  }

  private async handleActiveSet(value: CharacteristicValue): Promise<void> {
    if (!this.device) {
      return;
    }

    const isActive = Number(value) === this.platform.Characteristic.Active.ACTIVE;
    const payload = isActive ? AC_POWER_ON : AC_POWER_OFF;

    await this.platform.sendDeviceParams(this.device, payload);

    this.device.params = this.device.params ?? {};
    this.device.state = isActive ? 1 : 0;
    this.device.params[AC_POWER] = isActive ? 1 : 0;
    this.platform.updateCachedDevice(this.device);
    this.updateCharacteristicsFromDevice();
  }

  private handleActiveGet(): CharacteristicValue {
    if (!this.device) {
      return this.platform.Characteristic.Active.INACTIVE;
    }

    const active = this.device.state === 1 || this.device.params[AC_POWER] === 1;
    return active ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE;
  }

  private async handleTargetStateSet(value: CharacteristicValue): Promise<void> {
    if (!this.device) {
      return;
    }

    const auxMode = this.mapTargetStateToAuxMode(Number(value));
    await this.platform.sendDeviceParams(this.device, { [AUX_MODE]: auxMode });

    this.device.params = this.device.params ?? {};
    this.device.params[AUX_MODE] = auxMode;
    this.platform.updateCachedDevice(this.device);
    this.updateCharacteristicsFromDevice();
  }

  private handleTargetStateGet(): CharacteristicValue {
    if (!this.device) {
      return this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
    }
    const auxMode = this.device.params[AUX_MODE];
    return this.mapAuxModeToTargetState(auxMode);
  }

  private handleCurrentHeaterCoolerStateGet(): CharacteristicValue {
    if (!this.device) {
      return this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE;
    }

    const { CurrentHeaterCoolerState } = this.platform.Characteristic;

    if (this.device.state !== 1 && this.device.params[AC_POWER] !== 1) {
      return CurrentHeaterCoolerState.INACTIVE;
    }

    const auxMode = this.device.params[AUX_MODE];
    switch (auxMode) {
      case AuxAcModeValue.HEATING:
        return CurrentHeaterCoolerState.HEATING;
      case AuxAcModeValue.COOLING:
        return CurrentHeaterCoolerState.COOLING;
      default:
        return CurrentHeaterCoolerState.IDLE;
    }
  }

  private handleCurrentTemperatureGet(): CharacteristicValue {
    const celsius = this.getCelsiusParam(AC_TEMPERATURE_AMBIENT);
    if (celsius === undefined) {
      return this.defaultTargetDisplay;
    }
    return roundToOneDecimal(celsiusToDisplay(celsius, this.temperatureUnit));
  }

  private async handleTargetTemperatureSet(value: CharacteristicValue): Promise<void> {
    if (!this.device) {
      return;
    }

    const requestedDisplay = Number(value);
    const clampedDisplay = this.clampDisplayTemperature(requestedDisplay);
    const celsius = displayToCelsius(clampedDisplay, this.temperatureUnit);
    const scaled = Math.round(celsius * 10);

    await this.platform.sendDeviceParams(this.device, { [AC_TEMPERATURE_TARGET]: scaled });

    this.device.params = this.device.params ?? {};
    this.device.params[AC_TEMPERATURE_TARGET] = scaled;
    this.platform.updateCachedDevice(this.device);
    this.updateCharacteristicsFromDevice();
  }

  private handleTargetTemperatureGet(): CharacteristicValue {
    const celsius = this.getCelsiusParam(AC_TEMPERATURE_TARGET);
    const display = celsiusToDisplay(celsius ?? DEFAULT_TEMPERATURE_C, this.temperatureUnit);
    return this.clampDisplayTemperature(display);
  }

  private async handleRotationSpeedSet(value: CharacteristicValue): Promise<void> {
    if (!this.device || !this.supportsFanSpeed) {
      return;
    }

    const percent = clamp(Number(value), 0, 100);
    const auxSpeed = this.mapRotationToAuxFanSpeed(percent);

    await this.platform.sendDeviceParams(this.device, { [AC_FAN_SPEED]: auxSpeed });

    this.device.params = this.device.params ?? {};
    this.device.params[AC_FAN_SPEED] = auxSpeed;
    this.platform.updateCachedDevice(this.device);
    this.updateCharacteristicsFromDevice();
  }

  private handleRotationSpeedGet(): CharacteristicValue {
    if (!this.device || !this.supportsFanSpeed) {
      return 0;
    }

    const raw = this.device.params[AC_FAN_SPEED];
    return this.mapAuxFanSpeedToRotation(typeof raw === 'number' ? raw : AuxFanSpeed.AUTO);
  }

  private async handleSwingModeSet(value: CharacteristicValue): Promise<void> {
    if (!this.device || (!this.supportsSwingHorizontal && !this.supportsSwingVertical)) {
      return;
    }

    const enabled = Number(value) === this.platform.Characteristic.SwingMode.SWING_ENABLED;
    const payload: Record<string, number> = {};

    if (this.supportsSwingVertical) {
      Object.assign(payload, enabled ? AC_SWING_VERTICAL_ON : AC_SWING_VERTICAL_OFF);
      this.device.params[AC_SWING_VERTICAL] = enabled ? 1 : 0;
    }

    if (this.supportsSwingHorizontal) {
      Object.assign(payload, enabled ? AC_SWING_HORIZONTAL_ON : AC_SWING_HORIZONTAL_OFF);
      this.device.params[AC_SWING_HORIZONTAL] = enabled ? 1 : 0;
    }

    await this.platform.sendDeviceParams(this.device, payload);
    this.platform.updateCachedDevice(this.device);
    this.updateCharacteristicsFromDevice();
  }

  private handleSwingModeGet(): CharacteristicValue {
    if (!this.device || (!this.supportsSwingHorizontal && !this.supportsSwingVertical)) {
      return this.platform.Characteristic.SwingMode.SWING_DISABLED;
    }

    const vertical = this.supportsSwingVertical ? this.device.params[AC_SWING_VERTICAL] === 1 : false;
    const horizontal = this.supportsSwingHorizontal ? this.device.params[AC_SWING_HORIZONTAL] === 1 : false;

    return (vertical || horizontal)
      ? this.platform.Characteristic.SwingMode.SWING_ENABLED
      : this.platform.Characteristic.SwingMode.SWING_DISABLED;
  }

  private async handleLockPhysicalControlsSet(value: CharacteristicValue): Promise<void> {
    if (!this.device || !this.supportsChildLock) {
      return;
    }

    const locked = Number(value) === this.platform.Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED;
    const payload = locked ? AC_CHILD_LOCK_ON : AC_CHILD_LOCK_OFF;

    await this.platform.sendDeviceParams(this.device, payload);

    this.device.params = this.device.params ?? {};
    this.device.params[AC_CHILD_LOCK] = locked ? 1 : 0;
    this.platform.updateCachedDevice(this.device);
    this.updateCharacteristicsFromDevice();
  }

  private handleLockPhysicalControlsGet(): CharacteristicValue {
    if (!this.device || !this.supportsChildLock) {
      return this.platform.Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED;
    }

    const locked = this.device.params[AC_CHILD_LOCK] === 1;
    return locked
      ? this.platform.Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED
      : this.platform.Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED;
  }

  private updateCharacteristicsFromDevice(): void {
    if (!this.device) {
      return;
    }

    this.service.updateCharacteristic(this.platform.Characteristic.Active, this.handleActiveGet());
    this.service.updateCharacteristic(
      this.platform.Characteristic.TargetHeaterCoolerState,
      this.handleTargetStateGet(),
    );
    this.service.updateCharacteristic(
      this.platform.Characteristic.CurrentHeaterCoolerState,
      this.handleCurrentHeaterCoolerStateGet(),
    );
    this.service.updateCharacteristic(
      this.platform.Characteristic.CurrentTemperature,
      this.handleCurrentTemperatureGet(),
    );
    this.service.updateCharacteristic(
      this.platform.Characteristic.HeatingThresholdTemperature,
      this.handleTargetTemperatureGet(),
    );
    this.service.updateCharacteristic(
      this.platform.Characteristic.CoolingThresholdTemperature,
      this.handleTargetTemperatureGet(),
    );

    if (this.fanHandlersConfigured) {
      this.service.updateCharacteristic(
        this.platform.Characteristic.RotationSpeed,
        this.handleRotationSpeedGet(),
      );
    }

    if (this.swingHandlersConfigured) {
      this.service.updateCharacteristic(
        this.platform.Characteristic.SwingMode,
        this.handleSwingModeGet(),
      );
    }

    if (this.lockHandlersConfigured) {
      this.service.updateCharacteristic(
        this.platform.Characteristic.LockPhysicalControls,
        this.handleLockPhysicalControlsGet(),
      );
    }
  }

  private mapTargetStateToAuxMode(value: number): number {
    const { TargetHeaterCoolerState } = this.platform.Characteristic;
    switch (value) {
      case TargetHeaterCoolerState.COOL:
        return AuxAcModeValue.COOLING;
      case TargetHeaterCoolerState.HEAT:
        return AuxAcModeValue.HEATING;
      case TargetHeaterCoolerState.AUTO:
      default:
        return AuxAcModeValue.AUTO;
    }
  }

  private mapAuxModeToTargetState(auxMode?: number): number {
    const { TargetHeaterCoolerState } = this.platform.Characteristic;
    switch (auxMode) {
      case AuxAcModeValue.COOLING:
        return TargetHeaterCoolerState.COOL;
      case AuxAcModeValue.HEATING:
        return TargetHeaterCoolerState.HEAT;
      default:
        return TargetHeaterCoolerState.AUTO;
    }
  }

  private mapAuxFanSpeedToRotation(value: number): number {
    const entry = FAN_SPEED_LEVELS.find(level => level.aux === value);
    return entry ? entry.percent : 0;
  }

  private mapRotationToAuxFanSpeed(percent: number): number {
    let closest = FAN_SPEED_LEVELS[0];
    let smallestDelta = Math.abs(percent - closest.percent);

    for (const level of FAN_SPEED_LEVELS) {
      const delta = Math.abs(percent - level.percent);
      if (delta < smallestDelta) {
        closest = level;
        smallestDelta = delta;
      }
    }

    return closest.aux;
  }

  private getCelsiusParam(key: string): number | undefined {
    if (!this.device) {
      return undefined;
    }

    const raw = this.device.params[key];
    if (typeof raw !== 'number') {
      return undefined;
    }

    return raw / 10;
  }

  private clampDisplayTemperature(value: number): number {
    const clamped = clamp(value, this.minTargetDisplay, this.maxTargetDisplay);
    return this.roundToStep(clamped);
  }

  private roundToStep(value: number): number {
    const precision = 1 / this.temperatureStep;
    return Math.round(value * precision) / precision;
  }

  private getContext(): AuxCloudAccessoryContext {
    return this.accessory.context as AuxCloudAccessoryContext;
  }
}
