import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';

// Sentinel markers must match container-runner.ts
const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';
const { mockEnv, mockFiles } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string>,
  mockFiles: new Map<string, string>(),
}));

// Mock config
vi.mock('./config.js', () => ({
  CONTAINER_IMAGE: 'nanoclaw-agent:latest',
  CONTAINER_MAX_OUTPUT_SIZE: 10485760,
  CONTAINER_TIMEOUT: 1800000, // 30min
  CREDENTIAL_PROXY_PORT: 3001,
  DATA_DIR: '/tmp/nanoclaw-test-data',
  GROUPS_DIR: '/tmp/nanoclaw-test-groups',
  IDLE_TIMEOUT: 1800000, // 30min
  TIMEZONE: 'America/Los_Angeles',
}));

vi.mock('./env.js', () => ({
  readEnvFile: vi.fn((keys?: string[]) => {
    if (!keys) return { ...mockEnv };
    return Object.fromEntries(
      keys
        .filter((key) => mockEnv[key] != null)
        .map((key) => [key, mockEnv[key]]),
    );
  }),
}));

// Mock logger
vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn((file: string) => mockFiles.has(file)),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      readFileSync: vi.fn((file: string) => mockFiles.get(file) ?? ''),
      readdirSync: vi.fn(() => []),
      statSync: vi.fn(() => ({ isDirectory: () => false })),
      cpSync: vi.fn(),
      copyFileSync: vi.fn(),
    },
  };
});

// Mock mount-security
vi.mock('./mount-security.js', () => ({
  validateAdditionalMounts: vi.fn(() => []),
}));

// Create a controllable fake ChildProcess
function createFakeProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

let fakeProc: ReturnType<typeof createFakeProcess>;

// Mock child_process.spawn
vi.mock('child_process', async () => {
  const actual =
    await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawn: vi.fn(() => fakeProc),
    exec: vi.fn(
      (_cmd: string, _opts: unknown, cb?: (err: Error | null) => void) => {
        if (cb) cb(null);
        return new EventEmitter();
      },
    ),
  };
});

import { runContainerAgent, ContainerOutput } from './container-runner.js';
import type { RegisteredGroup } from './types.js';

const testGroup: RegisteredGroup = {
  name: 'Test Group',
  folder: 'test-group',
  trigger: '@Andy',
  added_at: new Date().toISOString(),
};

const testInput = {
  prompt: 'Hello',
  groupFolder: 'test-group',
  chatJid: 'test@g.us',
  isMain: false,
};

function emitOutputMarker(
  proc: ReturnType<typeof createFakeProcess>,
  output: ContainerOutput,
) {
  const json = JSON.stringify(output);
  proc.stdout.push(`${OUTPUT_START_MARKER}\n${json}\n${OUTPUT_END_MARKER}\n`);
}

describe('container-runner timeout behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeProc = createFakeProcess();
    for (const key of Object.keys(mockEnv)) delete mockEnv[key];
    mockFiles.clear();
    vi.mocked(fs.cpSync).mockClear();
    vi.mocked(fs.writeFileSync).mockClear();
    vi.mocked(fs.copyFileSync).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.AGENT_PROVIDER;
    delete process.env.CODEX_AUTH_MODE;
  });

  it('timeout after output resolves as success', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      onOutput,
    );

    // Emit output with a result
    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'Here is my response',
      newSessionId: 'session-123',
    });

    // Let output processing settle
    await vi.advanceTimersByTimeAsync(10);

    // Fire the hard timeout (IDLE_TIMEOUT + 30s = 1830000ms)
    await vi.advanceTimersByTimeAsync(1830000);

    // Emit close event (as if container was stopped by the timeout)
    fakeProc.emit('close', 137);

    // Let the promise resolve
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(result.newSessionId).toBe('session-123');
    expect(onOutput).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'Here is my response' }),
    );
  });

  it('timeout with no output resolves as error', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      onOutput,
    );

    // No output emitted — fire the hard timeout
    await vi.advanceTimersByTimeAsync(1830000);

    // Emit close event
    fakeProc.emit('close', 137);

    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('error');
    expect(result.error).toContain('timed out');
    expect(onOutput).not.toHaveBeenCalled();
  });

  it('normal exit after output resolves as success', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      onOutput,
    );

    // Emit output
    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'Done',
      newSessionId: 'session-456',
    });

    await vi.advanceTimersByTimeAsync(10);

    // Normal exit (no timeout)
    fakeProc.emit('close', 0);

    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(result.newSessionId).toBe('session-456');
  });

  it('uses codex provider env without anthopic proxy placeholders', async () => {
    process.env.AGENT_PROVIDER = 'codex';
    mockEnv.OPENAI_API_KEY = 'sk-test';
    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      vi.fn(async () => {}),
    );

    const spawnArgs = vi.mocked(spawn).mock.calls.at(-1)?.[1] as string[];
    expect(spawnArgs).toContain('NANOCLAW_AGENT_PROVIDER=codex');
    expect(spawnArgs).not.toContain('ANTHROPIC_API_KEY=placeholder');
    expect(spawnArgs).not.toContain('CLAUDE_CODE_OAUTH_TOKEN=placeholder');

    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'Done',
      newSessionId: 'session-codex',
    });
    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.newSessionId).toBe('session-codex');
  });

  it('writes API key auth.json for codex openai mode', async () => {
    process.env.AGENT_PROVIDER = 'codex';
    process.env.CODEX_AUTH_MODE = 'openai';
    mockEnv.OPENAI_API_KEY = 'sk-test';

    const resultPromise = runContainerAgent(
      testGroup,
      testInput,
      () => {},
      vi.fn(async () => {}),
    );

    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
      '/tmp/nanoclaw-test-data/sessions/test-group/.codex/auth.json',
      expect.stringContaining('"auth_mode": "apikey"'),
    );
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
      '/tmp/nanoclaw-test-data/sessions/test-group/.codex/auth.json',
      expect.stringContaining('"OPENAI_API_KEY": "sk-test"'),
    );

    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'Done',
      newSessionId: 'session-openai',
    });
    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);

    await resultPromise;
  });

  it('writes OAuth auth.json for codex openai-codex mode', async () => {
    process.env.AGENT_PROVIDER = 'codex';
    process.env.CODEX_AUTH_MODE = 'openai-codex';
    mockFiles.set(
      '/root/.codex/auth.json',
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: 'access',
          refresh_token: 'refresh',
        },
        last_refresh: '2026-03-18T00:00:00Z',
      }),
    );

    const osSpy = vi.spyOn(os, 'homedir');
    osSpy.mockReturnValue('/root');

    try {
      const resultPromise = runContainerAgent(
        testGroup,
        testInput,
        () => {},
        vi.fn(async () => {}),
      );

      expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
        '/tmp/nanoclaw-test-data/sessions/test-group/.codex/auth.json',
        expect.stringContaining('"auth_mode": "chatgpt"'),
      );
      expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
        '/tmp/nanoclaw-test-data/sessions/test-group/.codex/auth.json',
        expect.stringContaining('"access_token": "access"'),
      );

      emitOutputMarker(fakeProc, {
        status: 'success',
        result: 'Done',
        newSessionId: 'session-oauth',
      });
      await vi.advanceTimersByTimeAsync(10);
      fakeProc.emit('close', 0);
      await vi.advanceTimersByTimeAsync(10);

      await resultPromise;
    } finally {
      osSpy.mockRestore();
    }
  });

  it('copies codex skills from ~/.agents/skills into the group session', async () => {
    process.env.AGENT_PROVIDER = 'codex';
    process.env.CODEX_AUTH_MODE = 'openai';
    mockEnv.OPENAI_API_KEY = 'sk-test';
    mockFiles.set('/root/.agents/skills', '');

    const osSpy = vi.spyOn(os, 'homedir');
    osSpy.mockReturnValue('/root');
    vi.mocked(fs.statSync).mockImplementation(
      (file: fs.PathLike) =>
        ({
          isDirectory: () => file === '/root/.agents/skills',
        }) as fs.Stats,
    );

    try {
      const resultPromise = runContainerAgent(
        testGroup,
        testInput,
        () => {},
        vi.fn(async () => {}),
      );

      expect(vi.mocked(fs.cpSync)).toHaveBeenCalledWith(
        '/root/.agents/skills',
        '/tmp/nanoclaw-test-data/sessions/test-group/.codex/skills',
        { recursive: true },
      );

      emitOutputMarker(fakeProc, {
        status: 'success',
        result: 'Done',
        newSessionId: 'session-skills',
      });
      await vi.advanceTimersByTimeAsync(10);
      fakeProc.emit('close', 0);
      await vi.advanceTimersByTimeAsync(10);

      await resultPromise;
    } finally {
      osSpy.mockRestore();
    }
  });
});
