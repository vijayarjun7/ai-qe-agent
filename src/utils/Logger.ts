import * as winston from 'winston';
import * as path from 'path';
import * as fs from 'fs-extra';

const logsDir = path.join(process.cwd(), 'reports', 'logs');
fs.ensureDirSync(logsDir);

const { combine, timestamp, colorize, printf, errors } = winston.format;

const consoleFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}]: ${stack || message}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(errors({ stack: true }), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' })),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), consoleFormat),
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'agent.log'),
      maxsize: 5 * 1024 * 1024, // 5 MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'errors.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
    }),
  ],
});
