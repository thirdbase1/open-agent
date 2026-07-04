import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { Config } from '../../../base';
import { toolError } from './error';
import { createTool } from './utils';

const execFileAsync = promisify(execFile);

const ALL_COMMANDS = 'open read click dblclick fill type press keyboard keydown keyup hover focus select check uncheck scroll scrollintoview drag upload screenshot pdf snapshot eval connect stream close mcp get is find wait download mouse clipboard set cookies storage network tab window frame dialog trace profiler record console errors highlight inspect auth plugin confirm deny state session profiles dashboard doctor chat diff device tap swipe'.split(' ');

// Track install attempts so we only try once per process.
let installAttempted = false;

async function ensureInstalled(): Promise<void> {
  if (installAttempted) return;
  installAttempted = true;
  try {
    // Probe: is agent-browser already on PATH?
    await execFileAsync('agent-browser', ['--version'], { timeout: 5_000 });
    return;
  } catch {
    // Not installed — try to install globally + fetch Chrome.
    try {
      await execFileAsync('npm', ['install', '-g', 'agent-browser'], { timeout: 120_000 });
      await execFileAsync('agent-browser', ['install', '--yes'], { timeout: 180_000 });
    } catch (e) {
      // Silent — the run below will fall back to `npx -y agent-browser`.
      // eslint-disable-next-line no-console
      console.warn('[agent-browser] auto-install failed, will fall back to npx:', e);
    }
  }
}

export const createAgentBrowserTool = (config: Config) =>
  createTool({ toolName: 'agent_browser' }, {
    description:
      'Run the agent-browser CLI (Rust-based, agent-first browser automation).\n' +
      'Uses compact accessibility-tree snapshots with @refs for deterministic element selection.\n' +
      'Supports 60+ commands: ' + ALL_COMMANDS.join(', ') + '.\n' +
      'Also supports: read-without-browser for docs, auth vault, sessions, cookies, storage, network routing/HAR, console/errors, trace, video recording, profiler, visual diffing, MCP mode, mobile/iOS device flows, and dashboard.\n' +
      'FALLBACK: If the CLI is missing in the sandbox/runtime, install with `npm install -g agent-browser && agent-browser install --yes` (or use `npx -y agent-browser <cmd>`).',
    inputSchema: z.object({
      command: z.string().describe('Subcommand: open, snapshot, click, fill, screenshot, diff, read, etc.'),
      args: z.array(z.string()).default([]).describe('CLI args. Use @refs (e.g. @e1) after snapshot'),
      timeoutMs: z.number().default(60_000).describe('Max runtime in ms'),
    }),
    execute: async ({ command, args, timeoutMs }) => {
      try {
        await ensureInstalled();
        const base = config.copilot.agentBrowser.command || 'npx -y agent-browser';
        const parts = base.split(/\s+/).filter(Boolean);
        const { stdout, stderr } = await execFileAsync(
          parts[0],
          [...parts.slice(1), command, ...args],
          { timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024 }
        );
        return { stdout, stderr };
      } catch (e: any) {
        return toolError('agent-browser failed', e?.stderr || e?.message || String(e));
      }
    },
  });
