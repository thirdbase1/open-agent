import { createHash, randomUUID, randomBytes } from 'node:crypto';

import { Sandbox } from '@vercel/sandbox';
import { Logger } from '@nestjs/common';
import { z } from 'zod';

import { Config } from '../../../base';
import { StreamObjectToolResult } from '../providers';
import { CopilotStorage } from '../storage';
import { toolError } from './error';
import { createTool } from './utils';

// === Design ===
//
// One persistent Vercel Sandbox per chat (keyed by sessionId), running a real
// custom kernel — a small stdlib-only HTTP server inside the sandbox that:
//   - keeps a persistent Python globals() dict, so variables from one call
//     are still there in the next call, like a real notebook kernel.
//   - auto-captures rich output: the value of the last expression (like
//     Jupyter's Out[]) and any matplotlib figures left open, without the
//     model needing to know about an output-dir env var.
//   - supports "!pip install x" shell-escape lines, Jupyter-style.
//
// The sandbox VM itself only stays warm (and the kernel's in-memory state
// only survives) while it hasn't hit its timeout — we extend the timeout on
// every call to keep it alive through a normal chat. If a chat goes quiet
// long enough that Vercel stops the sandbox, the *filesystem* (files,
// pip-installed packages) comes back via the automatic snapshot on the next
// Sandbox.get(), but the kernel process itself restarts with a fresh
// in-memory namespace — same tradeoff a restarted Jupyter kernel has.

const logger = new Logger('VercelPythonSandboxTool');
const KERNEL_PORT = 39113;
const OUTPUT_ROOT = '/vercel/sandbox/outputs';
const TOKEN_FILE = '/vercel/sandbox/.oa_kernel_token';
const KERNEL_FILE = '/vercel/sandbox/.oa_kernel_server.py';

const BINARY_EXT: Record<string, string> = {
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.pdf': 'pdf',
  '.svg': 'svg',
};

function sandboxNameFor(sessionId?: string, userId?: string) {
  const key = sessionId || userId || 'anonymous';
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 24);
  return `oa-py-${hash}`;
}

// Stdlib-only Python kernel server. No pip deps needed to boot it, so it
// works even before the sandbox has anything installed.
const KERNEL_SOURCE = `
import ast, io, json, os, contextlib, subprocess, traceback, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

AUTH_TOKEN = os.environ.get("OA_KERNEL_TOKEN", "")
OUTPUT_ROOT = "${OUTPUT_ROOT}"
NAMESPACE = {"__name__": "__oa_kernel__"}


def capture_figures(call_dir):
    saved = []
    try:
        import matplotlib
        matplotlib.use("Agg", force=True)
        import matplotlib.pyplot as plt
        for num in plt.get_fignums():
            fig = plt.figure(num)
            path = os.path.join(call_dir, f"figure_{num}_{uuid.uuid4().hex[:6]}.png")
            fig.savefig(path, bbox_inches="tight")
            saved.append(os.path.basename(path))
        plt.close("all")
    except ImportError:
        pass
    except Exception:
        pass
    return saved


def run_code(code, call_dir):
    os.makedirs(call_dir, exist_ok=True)
    NAMESPACE["OA_OUTPUT_DIR"] = call_dir

    shell_lines, py_lines = [], []
    for line in code.split("\\n"):
        if line.strip().startswith("!"):
            shell_lines.append(line.strip()[1:])
        else:
            py_lines.append(line)
    shell_out = ""
    for cmd in shell_lines:
        proc = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        shell_out += proc.stdout + proc.stderr

    py_code = "\\n".join(py_lines)
    stdout, stderr, result_repr, error = io.StringIO(), io.StringIO(), None, None

    try:
        tree = ast.parse(py_code)
        last_expr = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last_expr = tree.body.pop()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            if tree.body:
                exec(compile(tree, "<oa_kernel>", "exec"), NAMESPACE)
            if last_expr is not None:
                value = eval(
                    compile(ast.Expression(last_expr.value), "<oa_kernel>", "eval"),
                    NAMESPACE,
                )
                if value is not None:
                    result_repr = repr(value)
    except Exception:
        error = traceback.format_exc()

    images = capture_figures(call_dir)
    return {
        "stdout": shell_out + stdout.getvalue(),
        "stderr": stderr.getvalue(),
        "result": result_repr,
        "error": error,
        "images": images,
    }


class Handler(BaseHTTPRequestHandler):
    def _unauthorized(self):
        self.send_response(403)
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.headers.get("Authorization") != f"Bearer {AUTH_TOKEN}":
            return self._unauthorized()
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        call_dir = os.path.join(OUTPUT_ROOT, body.get("callId", "default"))
        result = run_code(body.get("code", ""), call_dir)
        payload = json.dumps(result).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", ${KERNEL_PORT}), Handler).serve_forever()
`;

async function ensureKernel(
  sandbox: Sandbox
): Promise<{ url: string; token: string }> {
  // Reuse the same auth token across restarts (it's part of the persistent
  // filesystem), so a resumed sandbox doesn't need any new coordination.
  let token: string;
  try {
    const existing = await sandbox.fs.readFile(TOKEN_FILE);
    token = Buffer.isBuffer(existing) ? existing.toString('utf8').trim() : String(existing).trim();
    if (!token) throw new Error('empty token');
  } catch {
    token = randomBytes(24).toString('hex');
    await sandbox.writeFiles([{ path: TOKEN_FILE, content: Buffer.from(token) }]);
  }

  const url = sandbox.domain(KERNEL_PORT);

  const healthy = await fetch(`${url}/health`, { method: 'GET' })
    .then(r => r.ok)
    .catch(() => false);

  if (!healthy) {
    await sandbox.writeFiles([
      { path: KERNEL_FILE, content: Buffer.from(KERNEL_SOURCE) },
    ]);
    await sandbox.runCommand({
      cmd: 'python3',
      args: [KERNEL_FILE],
      detached: true,
      env: { OA_KERNEL_TOKEN: token },
    });
    // Give it a moment to bind the port.
    for (let i = 0; i < 20; i++) {
      const ok = await fetch(`${url}/health`).then(r => r.ok).catch(() => false);
      if (ok) break;
      await new Promise(r => setTimeout(r, 300));
    }
  }

  return { url, token };
}

export const createVercelPythonSandboxTool = (
  toolStream: WritableStream<StreamObjectToolResult>,
  _config: Config,
  copilotStorage: CopilotStorage,
  userId: string,
  sessionId?: string
) => {
  return createTool(
    { toolName: 'vercel_python_sandbox' },
    {
      description: `
Execute Python in a persistent, stateful kernel tied to this chat — like a real notebook cell, not a one-shot script.

**Real persistence across calls in this chat:**
- Variables, imports, and objects from earlier calls are still in memory for later calls (as long as the chat stays active — a long gap may cool the sandbox down, which restarts the kernel with a clean namespace but keeps all files and installed packages).
- pip installs and files also persist.

**Automatic rich output — no manual save step needed:**
- The value of the last expression in your code is captured automatically and returned as "result" (like a Jupyter cell), e.g. just write \`df.head()\` as the last line.
- Any matplotlib figures left open when your code finishes are automatically captured and returned as image URLs — no explicit savefig call required (though you can still call savefig yourself if you want).
- Lines starting with "!" run as shell commands (e.g. "!pip install pandas").

Output is JSON with: "stdout", "stderr", "result" (repr of the last expression, or null), "error" (traceback string, or null), and "images" (array of { name, url }).

Use image URLs directly in markdown: ![](url)
`,
      inputSchema: z.object({
        code: z
          .string()
          .describe(
            'Python code for this cell. Can reference variables/imports from earlier calls in this chat.'
          ),
      }),
      execute: async ({ code }, { toolCallId }) => {
        const writer = toolStream.getWriter();
        const name = sandboxNameFor(sessionId, userId);
        const callId = randomUUID();
        let sandbox: Sandbox | undefined;

        try {
          try {
            sandbox = await Sandbox.get({ name });
          } catch {
            sandbox = await Sandbox.create({
              name,
              runtime: 'python3.13',
              timeout: 45 * 60 * 1000,
              ports: [KERNEL_PORT],
            });
          }

          // Keep the kernel warm for the rest of a normal chat turn cadence.
          await sandbox.extendTimeout(30 * 60 * 1000).catch(() => undefined);

          const { url, token } = await ensureKernel(sandbox);

          const res = await fetch(`${url}/exec`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ code, callId }),
          });

          if (!res.ok) {
            throw new Error(`Kernel returned HTTP ${res.status}`);
          }
          const result = (await res.json()) as {
            stdout: string;
            stderr: string;
            result: string | null;
            error: string | null;
            images: string[];
          };

          if (result.stdout) {
            await writer.write({
              type: 'tool-incomplete-result',
              toolCallId,
              data: { type: 'text-delta', textDelta: result.stdout },
            });
          }

          const files: { name: string; url: string }[] = [];
          for (const fileName of result.images) {
            try {
              const buf = await sandbox.fs.readFile(
                `${OUTPUT_ROOT}/${callId}/${fileName}`
              );
              const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
              const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
              const format = BINARY_EXT[ext] ?? 'bin';
              const fileHash = createHash('sha256').update(buffer).digest('hex');
              const fileKey = `vercel-sandbox-${format}-${fileHash}${ext}`;
              const url2 = await copilotStorage.put(userId, fileKey, buffer, true);
              files.push({ name: fileName, url: url2 });
            } catch (e: any) {
              logger.error(`Failed to read/upload output file ${fileName}:`, e);
            }
          }

          return {
            stdout: result.stdout,
            stderr: result.stderr,
            result: result.result,
            error: result.error,
            images: files,
          };
        } catch (e: any) {
          return toolError('Vercel Python Sandbox Failed', e.message);
        } finally {
          writer.releaseLock();
          // Deliberately NOT stopping the sandbox here — stopping would kill
          // the kernel process and lose in-memory state immediately. We let
          // it idle out on Vercel's own timeout instead, trading a bit of
          // idle cost for real notebook-style persistence within a chat.
        }
      },
    }
  );
};
