/** Tiny logger with high-resolution timestamps so we can audit hot-path latency. */
const start = performance.now();

function ts(): string {
  const ms = (performance.now() - start).toFixed(1).padStart(8, " ");
  return `[+${ms}ms]`;
}

export const log = {
  info(...args: unknown[]): void {
    console.log(ts(), ...args);
  },
  warn(...args: unknown[]): void {
    console.warn(ts(), "WARN", ...args);
  },
  error(...args: unknown[]): void {
    console.error(ts(), "ERROR", ...args);
  },
  debug(...args: unknown[]): void {
    if (process.env.DEBUG) console.log(ts(), "DEBUG", ...args);
  },
};
