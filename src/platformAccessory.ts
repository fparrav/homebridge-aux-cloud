import type { Characteristic, CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import {
  AC_CHILD_LOCK,
  AC_CHILD_LOCK_OFF,
  AC_CHILD_LOCK_ON,
  AC_CLEAN,
  AC_CLEAN_OFF,
  AC_CLEAN_ON,
  AC_COMFORTABLE_WIND,
  AC_COMFORTABLE_WIND_OFF,
  AC_COMFORTABLE_WIND_ON,
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
  AC_SCREEN_DISPLAY,
  AC_SCREEN_DISPLAY_OFF,
  AC_SCREEN_DISPLAY_ON,
  AC_SLEEP,
  AC_SLEEP_OFF,
  AC_SLEEP_ON,
  AC_SWING_HORIZONTAL,
  AC_SWING_HORIZONTAL_OFF,
  AC_SWING_HORIZONTAL_ON,
  AC_SWING_VERTICAL,
  AC_SWING_VERTICAL_OFF,
  AC_SWING_VERTICAL_ON,
  AC_TEMPERATURE_AMBIENT,
  AC_TEMPERATURE_TARGET,
  AUX_ECOMODE,
  AUX_ECOMODE_OFF,
  AUX_ECOMODE_ON,
  AuxAcModeValue,
  AuxFanSpeed,
  AuxProducts,
  AUX_MODE,
} from './api/constants';
import type { AuxDevice } from './api/AuxCloudClient';
import type { AuxCloudPlatform, FeatureSwitchKey } from './platform';

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
const FAN_ROTATION_STEP = 20;

const FAN_SPEED_LEVELS: Array<{ aux: AuxFanSpeed; percent: number }> = [
  { aux: AuxFanSpeed.AUTO, percent: 0 },
  { aux: AuxFanSpeed.MUTE, percent: 20 },
  { aux: AuxFanSpeed.LOW, percent: 40 },
  { aux: AuxFanSpeed.MEDIUM, percent: 60 },
  { aux: AuxFanSpeed.HIGH, percent: 80 },
  { aux: AuxFanSpeed.TURBO, percent: 100 },
];

const roundToOneDecimal = (value: number): number => Math.round(value * 10) / 10;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const celsiusToDisplay = (celsius: number, unit: 'C' | 'F'): number =>
  unit === 'F' ? roundToOneDecimal((celsius * 9) / 5 + 32) : roundToOneDecimal(celsius);

const displayToCelsius = (value: number, unit: 'C' | 'F'): number =>
  unit === 'F' ? ((value - 32) * 5) / 9 : value;

interface FeatureSwitchDefinition {
  readonly label: string;
  readonly param: string;
  readonly onPayload: Record<string, number>;
  readonly offPayload: Record<string, number>;
}

const FEATURE_SWITCH_CONFIG: Record<FeatureSwitchKey, FeatureSwitchDefinition> = {
  screenDisplay: {
    label: 'Screen Display',
    param: AC_SCREEN_DISPLAY,
    onPayload: AC_SCREEN_DISPLAY_ON,
    offPayload: AC_SCREEN_DISPLAY_OFF,
  },
  comfortableWind: {
    label: 'Comfortable Wind',
    param: AC_COMFORTABLE_WIND,
    onPayload: AC_COMFORTABLE_WIND_ON,
    offPayload: AC_COMFORTABLE_WIND_OFF,
  },
  mildewProof: {
    label: 'Mildew Proof',
    param: AC_MILDEW_PROOF,
    onPayload: AC_MILDEW_PROOF_ON,
    offPayload: AC_MILDEW_PROOF_OFF,
  },
  clean: {
    label: 'Self Clean',
    param: AC_CLEAN,
    onPayload: AC_CLEAN_ON,
    offPayload: AC_CLEAN_OFF,
  },
  health: {
    label: 'Health Mode',
    param: AC_HEALTH,
    onPayload: AC_HEALTH_ON,
    offPayload: AC_HEALTH_OFF,
  },
  eco: {
    label: 'Eco Mode',
    param: AUX_ECOMODE,
    onPayload: AUX_ECOMODE_ON,
    offPayload: AUX_ECOMODE_OFF,
  },
  sleep: {
    label: 'Sleep Mode',
    param: AC_SLEEP,
    onPayload: AC_SLEEP_ON,
    offPayload: AC_SLEEP_OFF,
  },
};

export class AuxCloudPlatformAccessory {
  private readonly service: Service;

  private readonly temperatureUnit: 'C' | 'F';

  private readonly temperatureStep: number;

  private readonly featureSwitches: Set<FeatureSwitchKey>;

  private readonly featureSwitchServices = new Map<FeatureSwitchKey, Service>();

  private device?: AuxDevice;

  private supportsFanSpeed = false;

  private supportsSwingVertical = false;

  private supportsSwingHorizontal = false;

  private supportsChildLock = false;

  constructor(
    private readonly platform: AuxCloudPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.temperatureUnit = platform.temperatureUnit;
    this.temperatureStep = platform.temperatureStep;
    this.featureSwitches = platform.featureSwitches;

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

    this.configureBaseCharacteristics();
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
    this.service.updateCharacteristic(
      this.platform.Characteristic.TemperatureDisplayUnits,
      this.temperatureUnit === 'F'
        ? this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT
        : this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS,
    );

    this.supportsFanSpeed = typeof device.params[AC_FAN_SPEED] === 'number';
    this.supportsSwingVertical = typeof device.params[AC_SWING_VERTICAL] === 'number';
    this.supportsSwingHorizontal = typeof device.params[AC_SWING_HORIZONTAL] === 'number';
    this.supportsChildLock = typeof device.params[AC_CHILD_LOCK] === 'number';

    this.configureFanCharacteristic();
    this.configureSwingCharacteristic();
    this.configureChildLockCharacteristic();
    this.configureFeatureSwitches();

    this.updateCharacteristicsFromDevice();
  }

  private configureBaseCharacteristics(): void {
    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.handleActiveSet.bind(this))
      .onGet(this.handleActiveGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
      .setProps({
        validValues: [
          this.platform.Characteristic.TargetHeaterCoolerState.AUTO,
          this.platform.Characteristic.TargetHeaterCoolerState.COOL,
          this.platform.Characteristic.TargetHeaterCoolerState.HEAT,
        ],
      })
      .onSet(this.handleTargetStateSet.bind(this))
      .onGet(this.handleTargetStateGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
      .onGet(this.handleCurrentHeaterCoolerStateGet.bind(this));

    const currentTemperatureMin = celsiusToDisplay(CURRENT_TEMPERATURE_MIN_C, this.temperatureUnit);
    const currentTemperatureMax = celsiusToDisplay(CURRENT_TEMPERATURE_MAX_C, this.temperatureUnit);

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .setProps({
        minValue: Math.min(currentTemperatureMin, currentTemperatureMax),
        maxValue: Math.max(currentTemperatureMin, currentTemperatureMax),
        minStep: 0.1,
      })
      .onGet(this.handleCurrentTemperatureGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .setProps({
        minValue: this.getDisplayMinTarget(),
        maxValue: this.getDisplayMaxTarget(),
        minStep: this.temperatureStep,
      })
      .onSet(this.handleTargetTemperatureSet.bind(this))
      .onGet(this.handleTargetTemperatureGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
      .setProps({
        minValue: this.getDisplayMinTarget(),
        maxValue: this.getDisplayMaxTarget(),
        minStep: this.temperatureStep,
      })
      .onSet(this.handleTargetTemperatureSet.bind(this))
      .onGet(this.handleTargetTemperatureGet.bind(this));
  }

  private configureFanCharacteristic(): void {
    const existing = this.findCharacteristic(this.platform.Characteristic.RotationSpeed.UUID);

    if (this.supportsFanSpeed) {
      const characteristic = existing ?? this.service.addCharacteristic(this.platform.Characteristic.RotationSpeed);
      characteristic.setProps({ minValue: 0, maxValue: 100, minStep: FAN_ROTATION_STEP });
      characteristic.onSet(this.handleRotationSpeedSet.bind(this))
        .onGet(this.handleRotationSpeedGet.bind(this));
    } else if (existing) {
      this.service.removeCharacteristic(existing);
    }
  }

  private configureSwingCharacteristic(): void {
    const existing = this.findCharacteristic(this.platform.Characteristic.SwingMode.UUID);
    const shouldExpose = this.supportsSwingVertical || this.supportsSwingHorizontal;

    if (shouldExpose) {
      const characteristic = existing ?? this.service.addCharacteristic(this.platform.Characteristic.SwingMode);
      characteristic.onSet(this.handleSwingModeSet.bind(this))
        .onGet(this.handleSwingModeGet.bind(this));
    } else if (existing) {
      this.service.removeCharacteristic(existing);
    }
  }

  private configureChildLockCharacteristic(): void {
    const existing = this.findCharacteristic(this.platform.Characteristic.LockPhysicalControls.UUID);

    if (this.supportsChildLock) {
      const characteristic = existing ?? this.service.addCharacteristic(this.platform.Characteristic.LockPhysicalControls);
      characteristic.onSet(this.handleLockPhysicalControlsSet.bind(this))
        .onGet(this.handleLockPhysicalControlsGet.bind(this));
    } else if (existing) {
      this.service.removeCharacteristic(existing);
    }
  }

  private configureFeatureSwitches(): void {
    if (!this.device) {
      return;
    }

    (Object.keys(FEATURE_SWITCH_CONFIG) as FeatureSwitchKey[]).forEach((feature) => {
      const definition = FEATURE_SWITCH_CONFIG[feature];
      const supported = typeof this.device?.params[definition.param] === 'number';
      const shouldExpose = this.featureSwitches.has(feature) && supported;
      const existing = this.featureSwitchServices.get(feature);

      if (shouldExpose) {
        const service = existing
          ?? this.accessory.getServiceById(this.platform.Service.Switch, feature)
          ?? this.accessory.addService(this.platform.Service.Switch, definition.label, feature);

        service.updateCharacteristic(this.platform.Characteristic.Name, definition.label);
        service.getCharacteristic(this.platform.Characteristic.On)
          .onSet(async (value) => {
            await this.handleFeatureSwitchSet(feature, Boolean(value));
          })
          .onGet(() => this.handleFeatureSwitchGet(feature));

        this.featureSwitchServices.set(feature, service);
      } else if (existing) {
        this.accessory.removeService(existing);
        this.featureSwitchServices.delete(feature);
      }
    });
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
    this.platform.requestRefresh(1500);
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
    this.platform.requestRefresh(1500);
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
    const valueC = celsius ?? DEFAULT_TEMPERATURE_C;

    if (this.temperatureUnit === 'F') {
      return roundToOneDecimal(celsiusToDisplay(valueC, 'F'));
    }

    return Number((valueC).toFixed(1));
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
    this.platform.requestRefresh(1500);
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
    this.platform.requestRefresh(1500);
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
    this.platform.requestRefresh(1500);
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
    this.platform.requestRefresh(1500);
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

  private async handleFeatureSwitchSet(feature: FeatureSwitchKey, enabled: boolean): Promise<void> {
    if (!this.device) {
      return;
    }

    const definition = FEATURE_SWITCH_CONFIG[feature];
    const payload = enabled ? definition.onPayload : definition.offPayload;

    await this.platform.sendDeviceParams(this.device, payload);

    this.device.params = this.device.params ?? {};
    this.device.params[definition.param] = enabled ? 1 : 0;
    this.platform.updateCachedDevice(this.device);
    this.updateCharacteristicsFromDevice();
    this.platform.requestRefresh(2000);
  }

  private handleFeatureSwitchGet(feature: FeatureSwitchKey): CharacteristicValue {
    if (!this.device) {
      return false;
    }

    const definition = FEATURE_SWITCH_CONFIG[feature];
    return this.device.params[definition.param] === 1;
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

    if (this.supportsFanSpeed) {
      this.service.updateCharacteristic(
        this.platform.Characteristic.RotationSpeed,
        this.handleRotationSpeedGet(),
      );
    }

    if (this.supportsSwingHorizontal || this.supportsSwingVertical) {
      this.service.updateCharacteristic(
        this.platform.Characteristic.SwingMode,
        this.handleSwingModeGet(),
      );
    }

    if (this.supportsChildLock) {
      this.service.updateCharacteristic(
        this.platform.Characteristic.LockPhysicalControls,
        this.handleLockPhysicalControlsGet(),
      );
    }

    for (const [feature, service] of this.featureSwitchServices.entries()) {
      service.updateCharacteristic(
        this.platform.Characteristic.On,
        this.handleFeatureSwitchGet(feature),
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
    const entry = FAN_SPEED_LEVELS.find((level) => level.aux === value);
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

  private getDisplayMinTarget(): number {
    return this.roundToStep(celsiusToDisplay(MIN_TARGET_TEMPERATURE_C, this.temperatureUnit));
  }

  private getDisplayMaxTarget(): number {
    return this.roundToStep(celsiusToDisplay(MAX_TARGET_TEMPERATURE_C, this.temperatureUnit));
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
    const clampedValue = clamp(value, this.getDisplayMinTarget(), this.getDisplayMaxTarget());
    return this.roundToStep(clampedValue);
  }

  private roundToStep(value: number): number {
    const precision = 1 / this.temperatureStep;
    return Math.round(value * precision) / precision;
  }

  private findCharacteristic(uuid: string): Characteristic | undefined {
    return this.service.characteristics.find((char) => char.UUID === uuid);
  }

  private getContext(): AuxCloudAccessoryContext {
    return this.accessory.context as AuxCloudAccessoryContext;
  }
}
