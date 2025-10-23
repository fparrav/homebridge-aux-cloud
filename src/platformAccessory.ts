import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { AuxCloudPlatform } from './platform';

interface AuxCloudContext {
  device?: {
    id: string;
    name: string;
  };
}

export class AuxCloudPlatformAccessory {
  private readonly service: Service;

  constructor(
    private readonly platform: AuxCloudPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const context = (this.accessory.context as AuxCloudContext).device ?? { id: 'unknown', name: accessory.displayName };

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'AUX')
      .setCharacteristic(this.platform.Characteristic.Model, 'AUX Cloud Device')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, context.id);

    this.service = this.accessory.getService(this.platform.Service.HeaterCooler)
      ?? this.accessory.addService(this.platform.Service.HeaterCooler);

    this.service.setCharacteristic(this.platform.Characteristic.Name, context.name);

    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.handleActiveSet.bind(this))
      .onGet(this.handleActiveGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.handleCurrentTemperatureGet.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
      .onSet(this.handleTargetStateSet.bind(this))
      .onGet(this.handleTargetStateGet.bind(this));
  }

  private async handleActiveSet(value: CharacteristicValue): Promise<void> {
    this.platform.log.debug('Set Active ->', value, this.accessory.displayName);
  }

  private async handleActiveGet(): Promise<CharacteristicValue> {
    this.platform.log.debug('Get Active <-', this.accessory.displayName);
    return this.service.getCharacteristic(this.platform.Characteristic.Active).value ?? 0;
  }

  private async handleCurrentTemperatureGet(): Promise<CharacteristicValue> {
    this.platform.log.debug('Get CurrentTemperature <-', this.accessory.displayName);
    return this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature).value ?? 24;
  }

  private async handleTargetStateSet(value: CharacteristicValue): Promise<void> {
    this.platform.log.debug('Set TargetHeaterCoolerState ->', value, this.accessory.displayName);
  }

  private async handleTargetStateGet(): Promise<CharacteristicValue> {
    this.platform.log.debug('Get TargetHeaterCoolerState <-', this.accessory.displayName);
    return this.service.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState).value
      ?? this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
  }
}
