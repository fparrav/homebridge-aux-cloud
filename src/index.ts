import type { API } from 'homebridge';

import { PLATFORM_NAME } from './settings';
import { AuxCloudPlatformProxy } from './Platform.Proxy';

export = (api: API): void => {
  api.registerPlatform(PLATFORM_NAME, AuxCloudPlatformProxy);
};
