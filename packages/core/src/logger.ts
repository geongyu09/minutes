type Level = 'debug' | 'info' | 'warn' | 'error';

function log(level: Level, message: string, extra?: unknown) {
  const entry = {
    level,
    time: new Date().toISOString(),
    message,
    ...(extra !== undefined ? { extra } : {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, extra?: unknown) => log('debug', message, extra),
  info: (message: string, extra?: unknown) => log('info', message, extra),
  warn: (message: string, extra?: unknown) => log('warn', message, extra),
  error: (message: string, extra?: unknown) => log('error', message, extra),
};
