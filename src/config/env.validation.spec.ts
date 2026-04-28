import 'reflect-metadata';
import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  it('converte valores numéricos e aplica defaults', () => {
    const environmentConfig = validateEnv({
      GITHUB_TOKEN: 'github-token',
      PORT: '4000',
      OLLAMA_TIMEOUT_MS: '120000',
    });

    expect(environmentConfig).toMatchObject({
      PORT: 4000,
      GITHUB_TOKEN: 'github-token',
      GITHUB_API_BASE_URL: 'https://api.github.com',
      CLAUDE_COMMAND: 'claude',
      CLAUDE_MODEL: 'haiku',
      CLAUDE_TIMEOUT_MS: 300000,
      OLLAMA_API_BASE_URL: 'http://localhost:11434/api',
      OLLAMA_COMMAND: 'ollama',
      OLLAMA_MODEL: 'qwen3-coder:30b',
      OLLAMA_TIMEOUT_MS: 120000,
      OLLAMA_AUTO_START: 'true',
      OLLAMA_STARTUP_TIMEOUT_MS: 30000,
      OLLAMA_WARMUP_ON_BOOT: 'true',
      OLLAMA_WARMUP_KEEP_ALIVE: '10m',
    });
  });

  it('lança erro quando a configuração obrigatória está inválida', () => {
    expect(() =>
      validateEnv({
        PORT: '0',
      }),
    ).toThrow('Configuração de ambiente inválida');

    expect(() =>
      validateEnv({
        PORT: '0',
      }),
    ).toThrow('GITHUB_TOKEN');
  });

  it('rejeita timeout do Claude abaixo do mínimo suportado', () => {
    expect(() =>
      validateEnv({
        GITHUB_TOKEN: 'github-token',
        CLAUDE_TIMEOUT_MS: '999',
      }),
    ).toThrow('CLAUDE_TIMEOUT_MS');
  });
});
