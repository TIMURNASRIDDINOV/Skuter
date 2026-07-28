/**
 * Minimal structured logging over stdout/stderr.
 *
 * Deliberately not `console.log`: the demo rules forbid stray console calls, and
 * routing everything through here keeps request logs, startup output and error
 * reporting consistent and easy to silence.
 */

function timestamp(): string {
  return new Date().toISOString();
}

export function logInfo(message: string): void {
  process.stdout.write(`${timestamp()}  ${message}\n`);
}

export function logWarn(message: string): void {
  process.stderr.write(`${timestamp()}  WARN  ${message}\n`);
}

export function logError(message: string, error?: unknown): void {
  const detail =
    error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : error === undefined ? '' : String(error);
  process.stderr.write(`${timestamp()}  ERROR ${message}${detail === '' ? '' : `\n${detail}`}\n`);
}

/** Plain writer for banners and multi-line output that should not be prefixed. */
export function write(message: string): void {
  process.stdout.write(`${message}\n`);
}
