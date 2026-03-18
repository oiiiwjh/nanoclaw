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
    delete process.env.CODEX_AUTH_MODE;
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

  it('detects codex API key auth from auth.json when API key is present', async () => {
    const { hasCodexApiKeyAuth, hasCodexAuth } = await import(
      './agent-provider.js'
    );
    mockFiles.set(
      '/tmp/home/.codex/auth.json',
      JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-test' }),
    );
    expect(hasCodexApiKeyAuth('/tmp/home')).toBe(true);
    expect(hasCodexAuth('/tmp/home')).toBe(true);
  });

  it('detects codex OAuth auth from auth.json tokens', async () => {
    const { hasCodexOAuthAuth, hasCodexAuth, resolveCodexAuthMode } =
      await import('./agent-provider.js');
    mockFiles.set(
      '/tmp/home/.codex/auth.json',
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          access_token: 'access',
          refresh_token: 'refresh',
        },
      }),
    );
    expect(hasCodexOAuthAuth('/tmp/home')).toBe(true);
    expect(hasCodexAuth('/tmp/home')).toBe(true);
    expect(resolveCodexAuthMode(undefined, '/tmp/home')).toBe('openai-codex');
  });

  it('reads codex auth mode from env', async () => {
    mockEnv.CODEX_AUTH_MODE = 'openai';
    const { getConfiguredCodexAuthMode } = await import('./agent-provider.js');
    expect(getConfiguredCodexAuthMode()).toBe('openai');
  });

  it('prefers group codex auth override over global config', async () => {
    mockEnv.CODEX_AUTH_MODE = 'openai';
    const { resolveCodexAuthMode } = await import('./agent-provider.js');
    expect(
      resolveCodexAuthMode(
        {
          name: 'Test',
          folder: 'test',
          trigger: '@Andy',
          added_at: new Date().toISOString(),
          containerConfig: { codexAuthMode: 'openai-codex' },
        },
        '/tmp/home',
      ),
    ).toBe('openai-codex');
  });

  it('falls back to openai when codex auth mode is not set', async () => {
    const { hasCodexAuth, resolveCodexAuthMode } = await import(
      './agent-provider.js'
    );
    expect(hasCodexAuth('/tmp/home')).toBe(false);
    expect(resolveCodexAuthMode(undefined, '/tmp/home')).toBe('openai');
  });
});
