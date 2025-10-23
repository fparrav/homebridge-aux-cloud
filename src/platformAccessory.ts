import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import {
  AC_POWER,
  AC_POWER_OFF,
  AC_POWER_ON,
  AC_TEMPERATURE_AMBIENT,
  AC_TEMPERATURE_TARGET,
  AuxAcModeValue,
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

const DEFAULT_TEMPERATURE = 24;

export class AuxCloudPlatformAccessory {
  private readonly service: Service;

  private device?: AuxDevice;

  constructor(
    private readonly platform: AuxCloudPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
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
      StatusActive,
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

    this.service.getCharacteristic(CurrentTemperature)
      .setProps({
        minValue: -40,
        maxValue: 60,
        minStep: 0.1,
      })
      .onGet(this.handleCurrentTemperatureGet.bind(this));

    this.service.getCharacteristic(HeatingThresholdTemperature)
      .setProps({ minValue: 16, maxValue: 30, minStep: 0.5 })
      .onSet(this.handleTargetTemperatureSet.bind(this))
      .onGet(this.handleTargetTemperatureGet.bind(this));

    this.service.getCharacteristic(CoolingThresholdTemperature)
      .setProps({ minValue: 16, maxValue: 30, minStep: 0.5 })
      .onSet(this.handleTargetTemperatureSet.bind(this))
      .onGet(this.handleTargetTemperatureGet.bind(this));

    this.service.updateCharacteristic(TemperatureDisplayUnits, TemperatureDisplayUnits.CELSIUS);
    this.service.updateCharacteristic(StatusActive, true);
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
    const ambient = this.getParamValue(AC_TEMPERATURE_AMBIENT);
    return ambient ?? DEFAULT_TEMPERATURE;
  }

  private async handleTargetTemperatureSet(value: CharacteristicValue): Promise<void> {
    if (!this.device) {
      return;
    }

    const temperature = Number(value);
    const scaled = Math.round(temperature * 10);

    await this.platform.sendDeviceParams(this.device, { [AC_TEMPERATURE_TARGET]: scaled });

    this.device.params = this.device.params ?? {};
    this.device.params[AC_TEMPERATURE_TARGET] = scaled;
    this.platform.updateCachedDevice(this.device);
    this.updateCharacteristicsFromDevice();
  }

  private handleTargetTemperatureGet(): CharacteristicValue {
    const target = this.getParamValue(AC_TEMPERATURE_TARGET);
    return target ?? DEFAULT_TEMPERATURE;
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
    const statusActive = this.handleActiveGet() === this.platform.Characteristic.Active.ACTIVE;
    this.service.updateCharacteristic(this.platform.Characteristic.StatusActive, statusActive);
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

  private getParamValue(key: string): number | undefined {
    if (!this.device) {
      return undefined;
    }

    const raw = this.device.params[key];
    if (typeof raw === 'number') {
      if (key === AC_TEMPERATURE_TARGET || key === AC_TEMPERATURE_AMBIENT) {
        return raw / 10;
      }
      return raw;
    }
    return undefined;
  }

  private getContext(): AuxCloudAccessoryContext {
    return this.accessory.context as AuxCloudAccessoryContext;
  }
}
