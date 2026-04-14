import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { OllamaService } from './ollama.service';

jest.mock('node:child_process', () => {
  const actualChildProcess =
    jest.requireActual<typeof import('node:child_process')>(
      'node:child_process',
    );

  return {
    ...actualChildProcess,
    spawn: jest.fn(),
  };
});

type MockSpawnedProcess = EventEmitter & {
  unref: jest.Mock<void, []>;
};

function createMockSpawnedProcess(): MockSpawnedProcess {
  const mockProcess = new EventEmitter() as MockSpawnedProcess;
  mockProcess.unref = jest.fn<void, []>();
  return mockProcess;
}

describe('OllamaService', () => {
  const originalFetch = global.fetch;
  const mockSpawn = jest.mocked(childProcess.spawn);

  const buildService = (
    overrides: Partial<Record<string, string | number>> = {},
  ): OllamaService => {
    const configServiceMock = {
      get: jest.fn((key: string) => {
        const defaultValues: Record<string, string | number> = {
          OLLAMA_API_BASE_URL: 'http://localhost:11434/api',
          OLLAMA_COMMAND: 'ollama',
          OLLAMA_MODEL: 'qwen3-coder:30b',
          OLLAMA_TIMEOUT_MS: 180000,
          OLLAMA_AUTO_START: 'true',
          OLLAMA_STARTUP_TIMEOUT_MS: 30000,
          OLLAMA_WARMUP_ON_BOOT: 'true',
          OLLAMA_WARMUP_KEEP_ALIVE: '10m',
        };

        return overrides[key] ?? defaultValues[key];
      }),
    };

    return new OllamaService(configServiceMock as never);
  };

  beforeEach(() => {
    global.fetch = jest.fn() as typeof fetch;
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('envia prompt ao Ollama e valida a resposta', async () => {
    const ollamaService = buildService({
      OLLAMA_API_BASE_URL: 'http://ollama.local/api',
      OLLAMA_TIMEOUT_MS: 120000,
    });
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: jest
        .fn()
        .mockResolvedValue(
          '{"message":{"content":"{\\"decision\\":\\"COMMENT\\",\\"body\\":\\"ok\\",\\"issues\\":[],\\"confidence\\":\\"medium\\"}"}}',
        ),
    } as never);

    await expect(ollamaService.runReview('analise este PR')).resolves.toEqual({
      decision: 'COMMENT',
      body: 'ok',
      issues: [],
      confidence: 'medium',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://ollama.local/api/chat',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(
      JSON.parse((fetchMock.mock.calls[0]?.[1]?.body as string) ?? '{}'),
    ).toEqual({
      model: 'qwen3-coder:30b',
      format: 'json',
      stream: false,
      messages: [{ role: 'user', content: 'analise este PR' }],
    });
  });

  it('lança erro claro quando não consegue conectar ao Ollama', async () => {
    const ollamaService = buildService();
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(ollamaService.runReview('prompt')).rejects.toThrow(
      'Falha ao conectar ao Ollama (qwen3-coder:30b): connect ECONNREFUSED',
    );
  });

  it('lança erro claro para resposta HTTP inválida com corpo JSON', async () => {
    const ollamaService = buildService();
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: jest.fn().mockResolvedValue('{"error":"model not found"}'),
    } as never);

    await expect(ollamaService.runReview('prompt')).rejects.toThrow(
      'Ollama retornou HTTP 503: model not found',
    );
  });

  it('lança erro claro para resposta HTTP inválida com corpo texto puro', async () => {
    const ollamaService = buildService();
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: jest.fn().mockResolvedValue('erro bruto'),
    } as never);

    await expect(ollamaService.runReview('prompt')).rejects.toThrow(
      'Ollama retornou HTTP 500: erro bruto',
    );
  });

  it('lança erro quando o corpo da resposta não é JSON válido', async () => {
    const ollamaService = buildService();
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue('nao-e-json'),
    } as never);

    await expect(ollamaService.runReview('prompt')).rejects.toThrow(
      'Resposta inválida do Ollama',
    );
  });

  it('lança erro quando o Ollama não retorna conteúdo em message.content', async () => {
    const ollamaService = buildService();
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue('{"message":{}}'),
    } as never);

    await expect(ollamaService.runReview('prompt')).rejects.toThrow(
      'Ollama não retornou conteúdo na mensagem.',
    );
  });

  it('lança erro quando o JSON retornado não passa no schema de review', async () => {
    const ollamaService = buildService();
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: jest
        .fn()
        .mockResolvedValue('{"message":{"content":"{\\"body\\":\\"ok\\"}"}}'),
    } as never);

    await expect(ollamaService.runReview('prompt')).rejects.toThrow(
      'Resposta inválida do Ollama',
    );
  });

  it('inicia o Ollama automaticamente e aquece o modelo na inicialização', async () => {
    const ollamaService = buildService();
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    const spawnedProcess = createMockSpawnedProcess();
    mockSpawn.mockReturnValue(spawnedProcess as never);
    fetchMock
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValueOnce({
        ok: true,
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue('{"load_duration":1000000}'),
      } as never);

    setImmediate(() => {
      spawnedProcess.emit('spawn');
    });

    await expect(ollamaService.prepareForRequests()).resolves.toBeUndefined();

    const spawnOptions = mockSpawn.mock.calls[0]?.[2];

    expect(mockSpawn.mock.calls[0]?.[0]).toBe('ollama');
    expect(mockSpawn.mock.calls[0]?.[1]).toEqual(['serve']);
    expect(spawnOptions).toMatchObject({
      detached: true,
      stdio: 'ignore',
    });
    expect(spawnOptions?.env).toMatchObject({
      OLLAMA_HOST: 'localhost:11434',
    });
    expect(spawnedProcess.unref).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:11434/api/tags',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'http://localhost:11434/api/tags',
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      'http://localhost:11434/api/generate',
    );
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(fetchMock.mock.calls[2]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(
      JSON.parse((fetchMock.mock.calls[2]?.[1]?.body as string) ?? '{}'),
    ).toEqual({
      model: 'qwen3-coder:30b',
      stream: false,
      keep_alive: '10m',
    });
  });

  it('não tenta auto-start quando o endpoint configurado não é local', async () => {
    const ollamaService = buildService({
      OLLAMA_API_BASE_URL: 'http://ollama.remote:11434/api',
    });
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(ollamaService.prepareForRequests()).resolves.toBeUndefined();

    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('não falha a inicialização quando o warm-up do modelo retorna erro', async () => {
    const ollamaService = buildService();
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
      } as never)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: jest.fn().mockResolvedValue('{"error":"model not found"}'),
      } as never);

    await expect(ollamaService.prepareForRequests()).resolves.toBeUndefined();

    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
