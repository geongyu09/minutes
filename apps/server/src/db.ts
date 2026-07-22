import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { config } from '@/config';

let instance: Database.Database | undefined;

/** 로컬 SQLite 연결 — 첫 사용 시점에 열고, sqlite-vec 확장을 로드한다. */
export function db(): Database.Database {
  if (!instance) {
    const filePath = path.resolve(process.cwd(), config.storage.sqlitePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    instance = new Database(filePath);
    instance.pragma('journal_mode = WAL');
    instance.pragma('foreign_keys = ON');
    sqliteVec.load(instance);
  }
  return instance;
}

export function closeDb(): void {
  instance?.close();
  instance = undefined;
}
