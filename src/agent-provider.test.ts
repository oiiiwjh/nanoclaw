import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv: Record<string, string> = {};
const mockFiles = new Map<string, string>();

vi.mock('./env.js', () => ({
  readEnvFile: vi.fn(() => ({ ...mockEnv })),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn((file: string) => mockFiles.has(file)),
    readFileSync: vi.fn((file: string) => {
      const content = mockFiles.get(file);
      if (content == null) throw new Error('ENOENT');
      return content;
    }),
  },
}));

describe('agent-provider', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockEnv)) delete mockEnv[key];
    mockFiles.clear();
    delete process.env.AGENT_PROVIDER;
  });

  it('defaults to claude', async () => {
    const { getConfiguredAgentProvider } = await import('./agent-provider.js');
    expect(getConfiguredAgentProvider()).toBe('claude');
  });

  it('reads codex provider from env', async () => {
    mockEnv.AGENT_PROVIDER = 'codex';
    const { getConfiguredAgentProvider } = await import('./agent-provider.js');
    expect(getConfiguredAgentProvider()).toBe('codex');
  });

  it('prefers group override over global config', async () => {
    mockEnv.AGENT_PROVIDER = 'claude';
    const { resolveAgentProvider } = await import('./agent-provider.js');
    expect(
      resolveAgentProvider({
        name: 'Test',
        folder: 'test',
        trigger: '@Andy',
        added_at: new Date().toISOString(),
        containerConfig: { agentProvider: 'codex' },
      }),
    ).toBe('codex');
  });

  it('detects codex auth from auth.json', async () => {
    const { hasCodexAuth } = await import('./agent-provider.js');
    mockFiles.set(
      '/tmp/home/.codex/auth.json',
      JSON.stringify({ tokens: { access_token: 'token' } }),
    );
    expect(hasCodexAuth('/tmp/home')).toBe(true);
  });

  it('returns false when codex auth is missing', async () => {
    const { hasCodexAuth } = await import('./agent-provider.js');
    expect(hasCodexAuth('/tmp/home')).toBe(false);
  });
});
