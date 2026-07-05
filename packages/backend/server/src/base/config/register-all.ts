import { APP_CONFIG_DESCRIPTORS } from './register';
// This file ensures all module config descriptors are registered
// before the ConfigFactory tries to read them.
// In ESM/tsx, side-effect imports from individual module index.ts files
// may not execute in the right order, so we explicitly import all configs here.

import '../graphql/config';
import '../helpers/config';
import '../job/queue/config';
import '../metrics/config';
import '../prisma/config';
import '../redis/config';
import '../throttler/config';
import '../websocket/config';
import '../../core/auth/config';
import '../../core/config/config';
import '../../core/mail/config';
import '../../core/storage/config';
import '../../core/version/config';
import '../../models/config';
import '../../plugins/captcha/config';
import '../../plugins/copilot/config';
import '../../plugins/oauth/config';

console.log(
  '[register-all] Config descriptors registered:',
  Object.keys(APP_CONFIG_DESCRIPTORS)
);
