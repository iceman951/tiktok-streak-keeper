import pino from 'pino';

const levels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];
const level = process.env.LOG_LEVEL ?? 'info';
export const logger = pino({
  level: levels.includes(level) ? level : 'info',
  base: null,
  redact: {
    paths: [
      'password',
      'cookies',
      'cookie',
      'token',
      'authorization',
      'session',
      'message',
      'username',
      'url',
      '*.password',
      '*.cookies',
      '*.token',
      '*.authorization',
      '*.session',
    ],
    censor: '[REDACTED]',
  },
});
