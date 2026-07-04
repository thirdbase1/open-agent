/// <reference types="./global.d.ts" />
import './prelude';

import { run as runCli } from './cli';
import { run as runServer } from './server';

// Catch unhandled errors so the process doesn't crash silently.
// These are logged but don't kill the server — individual module
// error handlers should deal with their own failures.
process.on('unhandledRejection', reason => {
  // eslint-disable-next-line no-console
  console.error('[open-agent] Unhandled promise rejection:', reason);
});

process.on('uncaughtException', err => {
  // eslint-disable-next-line no-console
  console.error('[open-agent] Uncaught exception:', err);
  // Don't exit — let the process continue if possible.
  // If something truly fatal happened, the NestJS bootstrap catch
  // below will handle it.
});

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
