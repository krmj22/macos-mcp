/**
 * HTTP server lifecycle helper for E2E tests.
 *
 * Spawns `node dist/index.js` as a subprocess with HTTP transport env vars,
 * waits for the health endpoint to respond, and provides cleanup.
 */

import { type ChildProcess, spawn } from 'node:child_process';

/** Fixed test port — avoids conflict with production 3847. */
export const HTTP_TEST_PORT = 48470;
export const HTTP_TEST_URL = `http://127.0.0.1:${HTTP_TEST_PORT}`;
export const MCP_ENDPOINT = `${HTTP_TEST_URL}/mcp`;

/** Server process reference. */
let serverProcess: ChildProcess | null = null;

/**
 * Start the HTTP server as a subprocess.
 * Waits for the /health endpoint to return 200 before resolving.
 *
 * @param timeoutMs - Max time to wait for server readiness (default 15s)
 * @returns The child process reference
 */
export async function startHttpServer(
  timeoutMs = 15_000,
): Promise<ChildProcess> {
  if (serverProcess) {
    throw new Error(
      'HTTP server already running — call stopHttpServer() first',
    );
  }

  const cwd = process.cwd();

  serverProcess = spawn('node', ['dist/index.js'], {
    cwd,
    env: {
      ...process.env,
      MCP_TRANSPORT: 'http',
      MCP_HTTP_ENABLED: 'true',
      MCP_HTTP_PORT: String(HTTP_TEST_PORT),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Collect stderr for diagnostics on failure
  let stderrBuffer = '';
  serverProcess.stderr?.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString();
  });

  serverProcess.on('exit', (code, _signal) => {
    if (code !== null && code !== 0) {
      console.error(
        `HTTP server exited with code ${code}. stderr:\n${stderrBuffer}`,
      );
    }
    serverProcess = null;
  });

  // Poll /health until 200 or timeout
  const start = Date.now();
  const pollInterval = 200;

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${HTTP_TEST_URL}/health`);
      if (res.ok) {
        console.log(
          `  HTTP server ready on port ${HTTP_TEST_PORT} (${Date.now() - start}ms)`,
        );
        return serverProcess!;
      }
    } catch {
      // Server not ready yet — retry
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  // Timeout — kill and throw
  serverProcess?.kill('SIGTERM');
  serverProcess = null;
  throw new Error(
    `HTTP server failed to start within ${timeoutMs}ms.\nstderr:\n${stderrBuffer}`,
  );
}

/**
 * Stop the HTTP server subprocess.
 * Sends SIGTERM and waits for the process to exit.
 *
 * @param timeoutMs - Max time to wait for graceful exit (default 5s)
 */
export async function stopHttpServer(timeoutMs = 5_000): Promise<void> {
  if (!serverProcess) return;

  const proc = serverProcess;
  serverProcess = null;

  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve();
    }, timeoutMs);

    proc.on('exit', () => {
      clearTimeout(timeout);
      resolve();
    });

    proc.kill('SIGTERM');
  });
}

/**
 * Returns true if the server process is currently running.
 */
export function isHttpServerRunning(): boolean {
  return serverProcess !== null && !serverProcess.killed;
}
