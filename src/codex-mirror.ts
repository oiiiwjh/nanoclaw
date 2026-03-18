import fs from 'fs';
import os from 'os';
import path from 'path';

import { DATA_DIR } from './config.js';
import { logger } from './logger.js';

interface SessionIndexEntry {
  id: string;
  thread_name?: string;
  updated_at?: string;
}

function readIndex(file: string): SessionIndexEntry[] {
  if (!fs.existsSync(file)) return [];

  const entries: SessionIndexEntry[] = [];
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as SessionIndexEntry);
    } catch {
      // Ignore malformed lines so one bad entry does not block syncing.
    }
  }
  return entries;
}

function writeIndex(file: string, entries: SessionIndexEntry[]): void {
  const content =
    entries.map((entry) => JSON.stringify(entry)).join('\n') +
    (entries.length > 0 ? '\n' : '');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function syncDirectory(srcDir: string, destDir: string): void {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });

  for (const entry of fs.readdirSync(srcDir)) {
    const src = path.join(srcDir, entry);
    const dest = path.join(destDir, entry);
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      syncDirectory(src, dest);
    } else if (stat.isFile()) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }
}

function prefixThreadName(
  threadName: string | undefined,
  groupLabel: string,
): string {
  const prefix = `[NanoClaw/${groupLabel}]`;
  if (!threadName) return `${prefix} Conversation`;
  return threadName.startsWith(prefix) ? threadName : `${prefix} ${threadName}`;
}

export function syncCodexMirror(
  groupFolder: string,
  groupName: string,
  homeDir = os.homedir(),
): void {
  const sourceHome = path.join(DATA_DIR, 'sessions', groupFolder, '.codex');
  const sourceSessions = path.join(sourceHome, 'sessions');
  const sourceIndex = path.join(sourceHome, 'session_index.jsonl');

  if (!fs.existsSync(sourceSessions) || !fs.existsSync(sourceIndex)) {
    return;
  }

  const hostHome = path.join(homeDir, '.codex');
  const hostSessions = path.join(hostHome, 'sessions');
  const hostIndex = path.join(hostHome, 'session_index.jsonl');

  syncDirectory(sourceSessions, hostSessions);

  const merged = new Map<string, SessionIndexEntry>();
  for (const entry of readIndex(hostIndex)) {
    merged.set(entry.id, entry);
  }

  for (const entry of readIndex(sourceIndex)) {
    if (!entry.id) continue;
    const existing = merged.get(entry.id);
    const nextEntry: SessionIndexEntry = {
      ...existing,
      ...entry,
      thread_name: prefixThreadName(entry.thread_name, groupName),
    };

    if (
      existing?.updated_at &&
      nextEntry.updated_at &&
      existing.updated_at > nextEntry.updated_at
    ) {
      nextEntry.updated_at = existing.updated_at;
    }

    merged.set(entry.id, nextEntry);
  }

  const sortedEntries = [...merged.values()].sort((a, b) =>
    (a.updated_at || '').localeCompare(b.updated_at || ''),
  );
  writeIndex(hostIndex, sortedEntries);

  logger.info(
    {
      groupFolder,
      groupName,
      mirroredSessions: readIndex(sourceIndex).length,
    },
    'Mirrored Codex sessions into host ~/.codex',
  );
}
