import fs from 'fs';
import os from 'os';
import path from 'path';

import { readEnvFile } from './env.js';
import type { RegisteredGroup } from './types.js';

export type AgentProvider = 'claude' | 'codex';

function normalizeAgentProvider(value?: string): AgentProvider {
  return value === 'codex' ? 'codex' : 'claude';
}

export function getConfiguredAgentProvider(): AgentProvider {
  const env = readEnvFile(['AGENT_PROVIDER']);
  return normalizeAgentProvider(process.env.AGENT_PROVIDER || env.AGENT_PROVIDER);
}

export function resolveAgentProvider(group?: RegisteredGroup): AgentProvider {
  return normalizeAgentProvider(
    group?.containerConfig?.agentProvider || getConfiguredAgentProvider(),
  );
}

export function getCodexAuthPath(homeDir = os.homedir()): string {
  return path.join(homeDir, '.codex', 'auth.json');
}

export function hasCodexAuth(homeDir = os.homedir()): boolean {
  const authPath = getCodexAuthPath(homeDir);
  if (!fs.existsSync(authPath)) return false;

  try {
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8')) as {
      OPENAI_API_KEY?: string;
      tokens?: { access_token?: string; refresh_token?: string };
    };
    return Boolean(
      auth.OPENAI_API_KEY ||
        auth.tokens?.access_token ||
        auth.tokens?.refresh_token,
    );
  } catch {
    return false;
  }
}
