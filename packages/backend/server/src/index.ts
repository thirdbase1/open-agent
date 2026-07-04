/// <reference types="./global.d.ts" />
import './prelude';

import { run as runCli } from './cli';
import { run as runServer } from './server';

async function main() {
  if (env.flavors.script) {
    await runCli();
  } else {
    await runServer();
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error('[open-agent] FATAL: Server failed to start');
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
