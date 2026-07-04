import { createHash, randomBytes } from 'node:crypto';

import { Sandbox } from '@vercel/sandbox';
import { Logger } from '@nestjs/common';
import { z } from 'zod';

import { Config } from '../../../base';
import { toolError } from './error';
import { createTool } from './utils';

// agent-browser runs inside a Vercel Sandbox microVM, not on the server
// container directly. This avoids needing Chrome/Chromium binaries in the
// Docker image and gives each browser session an isolated Linux environment.
//
// The sandbox runs Amazon Linux and needs system deps for Chromium. We install
// them on first use; with a snapshot ID (AGENT_BROWSER_SNAPSHOT_ID env) the
// sandbox boots from a pre-built image and skips the install step entirely.
//
// Auth is automatic on Vercel via VERCEL_OIDC_TOKEN. For local dev, set
// VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID.
//
// Docs: https://agent-browser.dev/next

const logger = new Logger('AgentBrowserTool');

const ALL_COMMANDS = 'open read click dblclick fill type press keyboard keydown keyup hover focus select check uncheck scroll scrollintoview drag upload screenshot pdf snapshot eval connect stream close mcp get is find wait download mouse clipboard set cookies storage network tab window frame dialog trace profiler record console errors highlight inspect auth plugin confirm deny state session profiles dashboard doctor chat diff device tap swipe'.split(' ');

const BROWSER_SANDBOX_PREFIX = 'oa-browser';
const INSTALL_LOCK_FILE = '/vercel/sandbox/.ab_installed';

function sandboxNameFor(sessionId?: string, userId?: string) {
  const key = sessionId || userId || 'anonymous';
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 24);
  return `${BROWSER_SANDBOX_PREFIX}-${hash}`;
}

// System dependencies required by Chromium on Amazon Linux (Vercel Sandbox).
const INSTALL_SCRIPT = [
  'dnf install -y',
  'alsa-lib atk at-spi2-atk cups-libs libdrm libXcomposite libXdamage',
  'libXrandr mesa-libgbm pango nss nspr libXScrnSaver gtk3 libXtst',
  'xorg-x11-server-Xvfb',
].join(' ');

async function ensureBrowserDeps(sandbox: Sandbox): Promise<void> {
  // Check if we already installed deps in this sandbox's persistent filesystem.
  try {
    await sandbox.fs.readFile(INSTALL_LOCK_FILE);
    return; // already installed
  } catch {
    // not installed yet — proceed
  }

  logger.log('Installing Chromium system dependencies in sandbox...');
  await sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', INSTALL_SCRIPT],
    timeout: 120_000,
  });

  // Install agent-browser CLI inside the sandbox.
  await sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', 'npm install -g agent-browser 2>/dev/null || true'],
    timeout: 120_000,
  });

  // Download Chrome for Testing.
  await sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', 'agent-browser install --yes 2>/dev/null || true'],
    timeout: 180_000,
  });

  await sandbox.writeFiles([
    { path: INSTALL_LOCK_FILE, content: Buffer.from('1') },
  ]);
  logger.log('Chromium dependencies installed successfully.');
}

async function getOrCreateSandbox(
  sessionId?: string,
  userId?: string
): Promise<Sandbox> {
  const name = sandboxNameFor(sessionId, userId);
  const snapshotId = process.env.AGENT_BROWSER_SNAPSHOT_ID;

  try {
    const existing = await Sandbox.get({ name });
    await existing.extendTimeout(30 * 60 * 1000).catch(() => undefined);
    return existing;
  } catch {
    // doesn't exist — create new
    const sandbox = await Sandbox.create({
      name,
      ...(snapshotId ? { image: snapshotId } : {}),
      timeout: 45 * 60 * 1000,
    });

    if (!snapshotId) {
      // No snapshot — need to install deps manually.
      await ensureBrowserDeps(sandbox);
    }

    return sandbox;
  }
}

export const createAgentBrowserTool = (
  config: Config,
  sessionId?: string,
  userId?: string
) =>
  createTool({ toolName: 'agent_browser' }, {
    description:
      'Run the agent-browser CLI inside an isolated Vercel Sandbox microVM.\n' +
      'Uses compact accessibility-tree snapshots with @refs for deterministic element selection.\n' +
      'Supports 60+ commands: ' + ALL_COMMANDS.join(', ') + '.\n' +
      'Also supports: read-without-browser for docs, auth vault, sessions, cookies, storage, ' +
      'network routing/HAR, console/errors, trace, video recording, profiler, visual diffing, ' +
      'MCP mode, mobile/iOS device flows, and dashboard.\n' +
      'Browser runs in an isolated Linux VM with headless Chrome — no binary size limits.',
    inputSchema: z.object({
      command: z.string().describe('Subcommand: open, snapshot, click, fill, screenshot, diff, read, etc.'),
      args: z.array(z.string()).default([]).describe('CLI args. Use @refs (e.g. @e1) after snapshot'),
      timeoutMs: z.number().default(60_000).describe('Max runtime in ms'),
    }),
    execute: async ({ command, args, timeoutMs }) => {
      let sandbox: Sandbox | undefined;
      try {
        sandbox = await getOrCreateSandbox(sessionId, userId);

        // Run the agent-browser command inside the sandbox.
        const result = await sandbox.runCommand({
          cmd: 'agent-browser',
          args: [command, ...args],
          timeout: timeoutMs,
        });

        const stdout = await result.stdout();
        const stderr = await result.stderr();
        const exitCode = result.exitCode;

        if (exitCode !== 0 && exitCode !== null) {
          return toolError(
            `agent-browser exited with code ${exitCode}`,
            stderr || stdout || `Command: agent-browser ${command} ${args.join(' ')}`
          );
        }

        return { stdout, stderr };
      } catch (e: any) {
        return toolError('agent-browser sandbox failed', e?.message || String(e));
      }
    },
  });
