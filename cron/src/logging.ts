import winston from 'winston';
import type { PulseConfig } from '@shared/config';

const { combine, timestamp, printf, colorize } = winston.format;

const customFormat = printf((info) => {
  return `${info['timestamp']} ${info.level} (${info['component']}) ${info.message}`;
});

// ANSI colors aid readability in a terminal but become escape-code noise in
// non-TTY sinks such as GitHub Actions logs — colorize only on a real TTY.
const formats = [timestamp(), ...(process.stdout.isTTY ? [colorize()] : []), customFormat];

const logger = winston.createLogger({
  level: 'info',
  format: combine(...formats),
  transports: [new winston.transports.Console()],
});

export function configureLogger(config: PulseConfig): void {
  logger.level = config.log.level;
}

export function getLogger(component: string): winston.Logger {
  return logger.child({ component });
}

/**
 * Render an unknown thrown value for a log line, preserving the stack trace for
 * Error instances. The job entrypoints previously logged `String(err)`, which
 * collapsed errors to "[object Object]"/message-only and dropped the stack.
 */
export function formatError(err: unknown): string {
  return err instanceof Error ? (err.stack ?? err.message) : String(err);
}
