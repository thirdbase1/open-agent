import { createHash, randomBytes } from 'node:crypto';

import { Sandbox } from '@vercel/sandbox';
import { Logger } from '@nestjs/common';
import { z } from 'zod';

import { Config } from '../../../base';
import { toolError } from './error';
import { createTool } from './utils';

// ═══════════════════════════════════════════════════════════════════════════
// agent-browser — Vercel Sandbox browser automation
// ═══════════════════════════════════════════════════════════════════════════
//
// agent-browser runs inside an isolated Vercel Sandbox microVM with headless
// Chrome. Each chat gets a persistent sandbox that survives across tool calls
// within the same conversation, so browser state (cookies, localStorage, open
// tabs) persists between commands.
//
// The sandbox runs Amazon Linux and needs system deps for Chromium. We install
// them on first use; with AGENT_BROWSER_SNAPSHOT_ID set, the sandbox boots from
// a pre-built image and skips installation entirely.
//
// Auth is automatic on Vercel via VERCEL_OIDC_TOKEN. For local dev, set
// VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID.
//
// Docs: https://agent-browser.dev/

const logger = new Logger('AgentBrowserTool');

const BROWSER_SANDBOX_PREFIX = 'oa-browser';
const INSTALL_LOCK_FILE = '/vercel/sandbox/.ab_installed';
const BROWSER_PORT = 9222; // CDP port for streaming/CDP mode

// System dependencies required by Chromium on Amazon Linux (Vercel Sandbox).
const INSTALL_SCRIPT = [
  'dnf install -y',
  'alsa-lib atk at-spi2-atk cups-libs libdrm libXcomposite libXdamage',
  'libXrandr mesa-libgbm pango nss nspr libXScrnSaver gtk3 libXtst',
  'xorg-x11-server-Xvbb fontconfig liberation-fonts',
].join(' ');

function sandboxNameFor(sessionId?: string, userId?: string) {
  const key = sessionId || userId || 'anonymous';
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 24);
  return `${BROWSER_SANDBOX_PREFIX}-${hash}`;
}

async function ensureBrowserDeps(sandbox: Sandbox): Promise<void> {
  try {
    await sandbox.fs.readFile(INSTALL_LOCK_FILE);
    return;
  } catch {
    // not installed yet
  }

  logger.log('Installing Chromium system dependencies in sandbox...');
  await sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', INSTALL_SCRIPT],
    timeout: 120_000,
  });

  await sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', 'npm install -g agent-browser 2>/dev/null || true'],
    timeout: 120_000,
  });

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
    const sandbox = await Sandbox.create({
      name,
      ...(snapshotId ? { image: snapshotId } : {}),
      timeout: 45 * 60 * 1000,
      ports: [BROWSER_PORT],
    });

    if (!snapshotId) {
      await ensureBrowserDeps(sandbox);
    }

    return sandbox;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// System prompt injected when browser-use is enabled
// ═══════════════════════════════════════════════════════════════════════════

export const BROWSER_USE_SYSTEM_PROMPT = `
<browser-automation-guide>
You have access to the agent_browser tool, which controls a real headless Chrome
browser running inside an isolated Vercel Sandbox microVM. The browser state
(cookies, localStorage, open tabs) persists across tool calls within the same
chat session.

## How to use agent-browser

The tool accepts a "command" (the agent-browser subcommand) and "args" (CLI
arguments). Always use --json for structured output when you need to parse
results programmatically.

## Core workflow

1. Open a page: agent_browser with command="open" args=["https://example.com"]
2. Take a snapshot: agent_browser with command="snapshot" args=["-i", "-c"]
   - -i = interactive elements only (buttons, links, inputs)
   - -c = compact (remove empty elements)
   - The snapshot returns @e1, @e2, etc. refs for element interaction
3. Interact using refs: agent_browser with command="click" args=["@e2"]
4. Re-snapshot after ANY page change (navigation, DOM update) — refs are
   invalidated when the page changes
5. Read text: agent_browser with command="read" args=["https://example.com"]
   - Fetches agent-readable text without launching Chrome (for static pages)
   - Omit URL to read the rendered DOM of the current active tab
6. Screenshot: agent_browser with command="screenshot" args=["--annotate"]
   - --annotate overlays numbered labels that map to @eN refs
7. Close when done: agent_browser with command="close" args=[]

## Available commands (full reference)

Navigation: open, read, close, connect, stream
Interaction: click, dblclick, fill, type, press, keyboard, keydown, keyup,
  hover, focus, select, check, uncheck, scroll, scrollintoview, drag, upload
Capture: screenshot, pdf, snapshot, eval
Get info: get text/html/value/attr/title/url/cdp-url/count/box/styles
State: is visible/enabled/checked
Find: find role/text/label/placeholder/alt/title/testid/first/last/nth
Wait: wait (element/time/text/url/load/fn/download)
Downloads: download, wait --download
Mouse: mouse move/down/up/wheel
Clipboard: clipboard read/write/copy/paste
Settings: set viewport/device/geo/offline/headers/credentials/media
Cookies: cookies (get/set/clear)
Storage: storage local/session (get/set/clear)
Network: network route/unroute/requests/request/har
Tabs: tab (new/close/select/list)
Windows: window (new/close/select/list)
Frames: frame (switch to iframe or main)
Dialogs: dialog (accept/dismiss)
Trace: trace start/stop
Profiler: profiler start/stop
Recording: record start/stop
Console: console (get/clear)
Errors: errors (get/clear)
Highlight: highlight (element)
Inspect: inspect (element)
Auth: auth (vault credential management)
Plugin: plugin (add/remove/list)
Confirm/deny: confirm/deny (action confirmation)
State: state save/load/export/import
Session: session list/info/id
Profiles: profiles (list available Chrome profiles)
Dashboard: dashboard (open web dashboard)
Doctor: doctor (run diagnostics)
Chat: chat (natural language browser control)
Diff: diff (visual regression testing)
Device: device (mobile emulation)
Tap/swipe: tap, swipe (mobile gestures)
MCP: mcp (start MCP stdio server)

## Best practices

- ALWAYS snapshot before interacting. Use -i -c for compact interactive-only output.
- Re-snapshot after any click that might navigate or change the DOM.
- Use "read" for fetching article/page text without needing a full browser session.
- Use screenshot --annotate when visual context helps (icons, canvas, layout).
- For forms: fill (clears first) vs type (appends). Use fill for most cases.
- For scrolling: scroll down 500, scroll up, scrollintoview @e5
- For waiting: wait @e5 (element), wait 3000 (ms), wait --text "Welcome"
- For file uploads: upload @e3 "/path/to/file"
- Network interception: network route "https://api.example.com/*" --abort
- Sessions: the browser session persists per chat, so you can build up state.
- For authenticated pages: use state save/load or --profile for Chrome profiles.
- Use --json when you need structured data for further processing.

## Security

- Only navigate to URLs the user requests or that are clearly relevant to the task.
- Do not enter credentials unless explicitly asked by the user.
- Be cautious with eval — only run trusted JavaScript.
- Close the browser when the task is complete to free resources.
</browser-automation-guide>
`;

// ═══════════════════════════════════════════════════════════════════════════
// Tool definition
// ═══════════════════════════════════════════════════════════════════════════

// All valid agent-browser commands from the official CLI reference.
const VALID_COMMANDS = [
  // Core navigation
  'open', 'read', 'close', 'connect', 'stream',
  // Interaction
  'click', 'dblclick', 'fill', 'type', 'press', 'keyboard',
  'keydown', 'keyup', 'hover', 'focus', 'select', 'check', 'uncheck',
  'scroll', 'scrollintoview', 'drag', 'upload',
  // Capture
  'screenshot', 'pdf', 'snapshot', 'eval',
  // Get info
  'get', 'is', 'find',
  // Wait
  'wait',
  // Downloads
  'download',
  // Mouse
  'mouse',
  // Clipboard
  'clipboard',
  // Settings
  'set',
  // Cookies & storage
  'cookies', 'storage',
  // Network
  'network',
  // Tabs & windows
  'tab', 'window', 'frame',
  // Dialogs
  'dialog',
  // Debug & profiling
  'trace', 'profiler', 'record', 'console', 'errors',
  // Visual
  'highlight', 'inspect', 'diff',
  // Auth
  'auth', 'plugin',
  // Confirmation
  'confirm', 'deny',
  // State management
  'state',
  // Sessions
  'session', 'profiles',
  // Utility
  'dashboard', 'doctor', 'chat',
  // Mobile
  'device', 'tap', 'swipe',
  // MCP
  'mcp',
] as const;

export const createAgentBrowserTool = (
  config: Config,
  sessionId?: string,
  userId?: string
) =>
  createTool({ toolName: 'agent_browser' }, {
    description:
      'Run agent-browser inside an isolated Vercel Sandbox with headless Chrome.\n' +
      'The browser session persists per chat — cookies, localStorage, and open\n' +
      'tabs survive across tool calls in the same conversation.\n\n' +
      'Workflow: open URL → snapshot -i -c → interact with @eN refs → re-snapshot\n' +
      'after page changes → close when done.\n\n' +
      `Valid commands: ${VALID_COMMANDS.join(', ')}\n\n` +
      'Key commands:\n' +
      '- open <url>: Launch browser and navigate\n' +
      '- snapshot -i -c: Get interactive accessibility tree with @eN refs\n' +
      '- click @eN: Click element by ref\n' +
      '- fill @eN "text": Clear and fill input\n' +
      '- read [url]: Get agent-readable page text (no Chrome needed for URLs)\n' +
      '- screenshot --annotate: Screenshot with numbered element labels\n' +
      '- eval "js": Execute JavaScript in page\n' +
      '- get text/html/value/attr @eN: Extract element data\n' +
      '- wait @eN|<ms>|--text "x": Wait for element, time, or text\n' +
      '- cookies/storage: Manage browser state\n' +
      '- network route <url> --abort: Block/mock requests\n' +
      '- state save/load: Persist auth state across sessions\n' +
      '- close: Close browser and free resources',
    inputSchema: z.object({
      command: z.enum(VALID_COMMANDS).describe(
        'The agent-browser subcommand to execute (e.g. open, snapshot, click, read, screenshot)'
      ),
      args: z.array(z.string()).default([]).describe(
        'CLI arguments for the command. Use @eN refs from snapshot for element ' +
        'targeting. Common flags: -i (interactive only), -c (compact), ' +
        '--json (structured output), --full (full page screenshot), ' +
        '--annotate (labeled screenshot), -d <n> (depth limit)'
      ),
      timeoutMs: z.number().default(90_000).describe(
        'Max runtime in milliseconds. Default 90s. Increase for slow pages or downloads.'
      ),
    }),
    execute: async ({ command, args, timeoutMs }) => {
      let sandbox: Sandbox | undefined;
      try {
        sandbox = await getOrCreateSandbox(sessionId, userId);

        // Build the full command array
        const fullArgs = [command, ...args];

        // Add --json by default for structured output, unless the command
        // doesn't support it or the user explicitly passed --json or wants
        // raw output (screenshot, pdf produce binary, read/snapshot have text output)
        const supportsJson = !['screenshot', 'pdf', 'upload', 'close', 'mcp'].includes(command);
        const hasJsonFlag = args.includes('--json');
        if (supportsJson && !hasJsonFlag) {
          fullArgs.push('--json');
        }

        const result = await sandbox.runCommand({
          cmd: 'agent-browser',
          args: fullArgs,
          timeout: timeoutMs,
        });

        const stdout = await result.stdout();
        const stderr = await result.stderr();
        const exitCode = result.exitCode;

        if (exitCode !== 0 && exitCode !== null) {
          // Try to parse JSON error if available
          let errorMsg = stderr || stdout;
          try {
            const parsed = JSON.parse(stdout);
            if (parsed.error) errorMsg = parsed.error;
          } catch {
            // not JSON, use raw output
          }
          return toolError(
            `agent-browser "${command}" exited with code ${exitCode}`,
            errorMsg || `Command: agent-browser ${fullArgs.join(' ')}`
          );
        }

        // For screenshot/pdf, the output is a file path — read and return it
        if (command === 'screenshot' || command === 'pdf') {
          // Try to extract the file path from stdout
          const pathMatch = stdout.match(/saved to:\s*(\S+)/) || stdout.match(/"path":\s*"([^"]+)"/);
          if (pathMatch?.[1]) {
            try {
              const fileBuffer = await sandbox.fs.readFile(pathMatch[1]);
              const base64 = Buffer.isBuffer(fileBuffer)
                ? fileBuffer.toString('base64')
                : Buffer.from(fileBuffer).toString('base64');
              return {
                stdout,
                stderr,
                fileBase64: base64,
                filePath: pathMatch[1],
                mimeType: command === 'screenshot' ? 'image/png' : 'application/pdf',
              };
            } catch {
              // Can't read the file — return path info
              return { stdout, stderr, filePath: pathMatch[1] };
            }
          }
        }

        return { stdout, stderr };
      } catch (e: any) {
        return toolError('agent-browser sandbox failed', e?.message || String(e));
      }
    },
  });
