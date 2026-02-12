/**
 * Shared E2E test utilities.
 *
 * Transport-agnostic helpers used by both stdio and HTTP E2E suites.
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

/** Prefix for E2E test data — used for cleanup identification. */
export const PREFIX = '[E2E-TEST]';

/** Single performance log entry. */
export interface PerfEntry {
  suite: string;
  step: string;
  ms: number;
}

/**
 * Call an MCP tool and return raw text content + timing.
 *
 * @param client - Connected MCP Client instance (stdio or HTTP transport)
 * @param name - Tool name (e.g. 'reminders_tasks')
 * @param args - Tool arguments
 * @param suite - Suite label for perf log (empty = skip logging)
 * @param perfLog - Optional perf log array to push entries to
 */
export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  suite = '',
  perfLog?: PerfEntry[],
): Promise<{ text: string; elapsed: number }> {
  const start = performance.now();
  const result = await client.callTool({ name, arguments: args });
  const elapsed = Math.round(performance.now() - start);
  const text =
    (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
  const step = `${name}(${args.action})`;
  console.log(`  ${step} → ${elapsed}ms`);
  if (suite && perfLog) perfLog.push({ suite, step, ms: elapsed });
  return { text, elapsed };
}

/**
 * Extract ID from success message.
 * Matches patterns like: "Successfully created reminder "title".\n- ID: xxx"
 */
export function extractId(text: string): string | undefined {
  const match = text.match(/ID:\s*(.+)/);
  return match?.[1]?.trim();
}

/** Format a Date as YYYY-MM-DD HH:mm:ss (local). */
export function fmt(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Print a formatted performance summary table. */
export function printPerfSummary(perfLog: PerfEntry[]): void {
  if (perfLog.length === 0) return;

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║              PERFORMANCE SUMMARY                        ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  const maxSuite = Math.max(...perfLog.map((e) => e.suite.length), 12);
  const maxStep = Math.max(...perfLog.map((e) => e.step.length), 20);
  console.log(
    `║ ${'Suite'.padEnd(maxSuite)}  ${'Step'.padEnd(maxStep)}  ${'Time'.padStart(7)} ║`,
  );
  console.log(
    `║ ${'─'.repeat(maxSuite)}  ${'─'.repeat(maxStep)}  ${'─'.repeat(7)} ║`,
  );
  for (const e of perfLog) {
    console.log(
      `║ ${e.suite.padEnd(maxSuite)}  ${e.step.padEnd(maxStep)}  ${String(`${e.ms}ms`).padStart(7)} ║`,
    );
  }
  console.log('╚══════════════════════════════════════════════════════════╝');
}
