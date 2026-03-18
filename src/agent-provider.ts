import fs from 'fs';
import os from 'os';
import path from 'path';

import { readEnvFile } from './env.js';
import type { RegisteredGroup } from './types.js';

export type AgentProvider = 'claude' | 'codex';
export type CodexAuthMode = 'openai' | 'openai-codex';

function normalizeAgentProvider(value?: string): AgentProvider {
  return value === 'codex' ? 'codex' : 'claude';
}

export function getConfiguredAgentProvider(): AgentProvider {
  const env = readEnvFile(['AGENT_PROVIDER']);
  return normalizeAgentProvider(
    process.env.AGENT_PROVIDER || env.AGENT_PROVIDER,
  );
}

export function resolveAgentProvider(group?: RegisteredGroup): AgentProvider {
  return normalizeAgentProvider(
    group?.containerConfig?.agentProvider || getConfiguredAgentProvider(),
  );
}

function normalizeCodexAuthMode(value?: string): CodexAuthMode | undefined {
  if (value === 'openai' || value === 'openai-codex') return value;
  return undefined;
}

export function getConfiguredCodexAuthMode(): CodexAuthMode | undefined {
  const env = readEnvFile(['CODEX_AUTH_MODE']);
  return normalizeCodexAuthMode(
    process.env.CODEX_AUTH_MODE || env.CODEX_AUTH_MODE,
  );
}

export function resolveCodexAuthMode(
  group?: RegisteredGroup,
  homeDir = os.homedir(),
): CodexAuthMode {
  const explicit = normalizeCodexAuthMode(
    group?.containerConfig?.codexAuthMode || getConfiguredCodexAuthMode(),
  );
  if (explicit) return explicit;
  return hasCodexOAuthAuth(homeDir) ? 'openai-codex' : 'openai';
}

export function getCodexAuthPath(homeDir = os.homedir()): string {
  return path.join(homeDir, '.codex', 'auth.json');
}

export function hasCodexAuth(homeDir = os.homedir()): boolean {
  return hasCodexApiKeyAuth(homeDir) || hasCodexOAuthAuth(homeDir);
}

export function hasCodexApiKeyAuth(homeDir = os.homedir()): boolean {
  const authPath = getCodexAuthPath(homeDir);
  if (!fs.existsSync(authPath)) return false;

  try {
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8')) as {
      OPENAI_API_KEY?: string;
    };
    return Boolean(auth.OPENAI_API_KEY);
  } catch {
    return false;
  }
}

export function hasCodexOAuthAuth(homeDir = os.homedir()): boolean {
  const authPath = getCodexAuthPath(homeDir);
  if (!fs.existsSync(authPath)) return false;

  try {
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8')) as {
      auth_mode?: string;
      tokens?: { access_token?: string; refresh_token?: string };
    };
    return Boolean(
      auth.auth_mode === 'chatgpt' &&
      auth.tokens?.access_token &&
      auth.tokens?.refresh_token,
    );
  } catch {
    return false;
  }
}
