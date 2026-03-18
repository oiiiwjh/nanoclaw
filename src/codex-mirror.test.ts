import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('codex-mirror', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('copies session files and merges index entries into host codex home', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-home-'));
    const projectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'nanoclaw-project-'),
    );
    tempDirs.push(homeDir, projectDir);

    const dataDir = path.join(projectDir, 'data', 'sessions', 'main', '.codex');
    const sourceSessionsDir = path.join(dataDir, 'sessions', '2026', '03');
    fs.mkdirSync(sourceSessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sourceSessionsDir, 'rollout-test.jsonl'),
      '{"type":"thread.started"}\n',
    );
    fs.writeFileSync(
      path.join(dataDir, 'session_index.jsonl'),
      JSON.stringify({
        id: 'thread-1',
        thread_name: 'Morning sync',
        updated_at: '2026-03-18T10:00:00Z',
      }) + '\n',
    );

    const oldCwd = process.cwd();
    process.chdir(projectDir);
    try {
      vi.resetModules();
      const { syncCodexMirror } = await import('./codex-mirror.js');
      syncCodexMirror('main', 'Main', homeDir);
    } finally {
      process.chdir(oldCwd);
    }

    const mirroredFile = path.join(
      homeDir,
      '.codex',
      'sessions',
      '2026',
      '03',
      'rollout-test.jsonl',
    );
    expect(fs.existsSync(mirroredFile)).toBe(true);

    const hostIndex = fs.readFileSync(
      path.join(homeDir, '.codex', 'session_index.jsonl'),
      'utf-8',
    );
    expect(hostIndex).toContain('thread-1');
    expect(hostIndex).toContain('[NanoClaw/Main] Morning sync');
  });
});
