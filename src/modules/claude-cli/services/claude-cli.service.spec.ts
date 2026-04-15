import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { ClaudeCliService } from './claude-cli.service';

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

type MockReadableStream = EventEmitter & {
  setEncoding: jest.Mock<void, [BufferEncoding]>;
};

type MockClaudeProcess = EventEmitter & {
  stdout: MockReadableStream;
  stderr: MockReadableStream;
  kill: jest.Mock<boolean, [NodeJS.Signals?]>;
  killed: boolean;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
};

function createMockReadableStream(): MockReadableStream {
  const stream = new EventEmitter() as MockReadableStream;
  stream.setEncoding = jest.fn<void, [BufferEncoding]>();
  return stream;
}

function createMockClaudeProcess(): MockClaudeProcess {
  const mockProcess = new EventEmitter() as MockClaudeProcess;
  mockProcess.stdout = createMockReadableStream();
  mockProcess.stderr = createMockReadableStream();
  mockProcess.killed = false;
  mockProcess.exitCode = null;
  mockProcess.signalCode = null;
  mockProcess.kill = jest.fn((signal?: NodeJS.Signals) => {
    if (signal) {
      mockProcess.killed = true;
    }

    return true;
  });
  return mockProcess;
}

describe('ClaudeCliService', () => {
  const mockSpawn = jest.mocked(childProcess.spawn);

  const buildService = (claudeCommand = 'claude-test'): ClaudeCliService => {
    const configServiceMock = {
      get: jest.fn((key: string) => {
        if (key === 'CLAUDE_COMMAND') {
          return claudeCommand;
        }

        if (key === 'CLAUDE_TIMEOUT_MS') {
          return 120000;
        }

        return undefined;
      }),
    };

    return new ClaudeCliService(configServiceMock as never);
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('executa o Claude CLI configurado e retorna a review validada', async () => {
    const claudeCliService = buildService('claude-custom');
    const runClaudeCommandSpy = jest
      .spyOn(claudeCliService as never, 'runClaudeCommand')
      .mockResolvedValue(
        '{"decision":"APPROVE","overview":"tudo certo","improvements":[],"testsNotes":"os testes cobrem o fluxo principal","negatives":[],"positives":["mudança coesa"],"issues":[],"confidence":"high"}',
      );

    await expect(claudeCliService.runReview('revise este PR')).resolves.toEqual(
      {
        decision: 'APPROVE',
        overview: 'tudo certo',
        improvements: [],
        testsNotes: 'os testes cobrem o fluxo principal',
        negatives: [],
        positives: ['mudança coesa'],
        issues: [],
        confidence: 'high',
      },
    );
    expect(runClaudeCommandSpy).toHaveBeenCalledWith(
      'claude-custom',
      ['-p', 'revise este PR'],
      120000,
    );
  });

  it('lança erro quando a resposta do Claude CLI não passa no schema', async () => {
    const claudeCliService = buildService();
    jest
      .spyOn(claudeCliService as never, 'runClaudeCommand')
      .mockResolvedValue('{"overview":"faltou decision"}');

    await expect(claudeCliService.runReview('revise este PR')).rejects.toThrow(
      'Resposta inválida do Claude CLI',
    );
  });

  it('resolve stdout quando o processo termina com código zero', async () => {
    const claudeCliService = buildService();
    const mockProcess = createMockClaudeProcess();
    mockSpawn.mockReturnValue(mockProcess as never);

    const commandPromise = (
      claudeCliService as unknown as {
        runClaudeCommand: (
          claudeCommand: string,
          commandArguments: string[],
          timeoutMs: number,
        ) => Promise<string>;
      }
    ).runClaudeCommand('claude', ['-p', 'prompt'], 120000);

    mockProcess.stdout.emit('data', '{"resultado":');
    mockProcess.stdout.emit('data', '"ok"}');
    mockProcess.stderr.emit('data', 'warning');
    mockProcess.emit('close', 0);

    await expect(commandPromise).resolves.toBe('{"resultado":"ok"}');
    expect(mockSpawn).toHaveBeenCalledWith('claude', ['-p', 'prompt'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(mockProcess.stdout.setEncoding).toHaveBeenCalledWith('utf8');
    expect(mockProcess.stderr.setEncoding).toHaveBeenCalledWith('utf8');
  });

  it('rejeita quando o processo termina com código diferente de zero', async () => {
    const claudeCliService = buildService();
    const mockProcess = createMockClaudeProcess();
    mockSpawn.mockReturnValue(mockProcess as never);

    const commandPromise = (
      claudeCliService as unknown as {
        runClaudeCommand: (
          claudeCommand: string,
          commandArguments: string[],
          timeoutMs: number,
        ) => Promise<string>;
      }
    ).runClaudeCommand('claude', ['-p', 'prompt'], 120000);

    mockProcess.stderr.emit('data', 'limite excedido');
    mockProcess.emit('close', 1);

    await expect(commandPromise).rejects.toThrow(
      'Claude CLI retornou código 1: limite excedido',
    );
  });

  it('rejeita quando o processo emite evento de erro', async () => {
    const claudeCliService = buildService();
    const mockProcess = createMockClaudeProcess();
    mockSpawn.mockReturnValue(mockProcess as never);

    const commandPromise = (
      claudeCliService as unknown as {
        runClaudeCommand: (
          claudeCommand: string,
          commandArguments: string[],
          timeoutMs: number,
        ) => Promise<string>;
      }
    ).runClaudeCommand('claude', ['-p', 'prompt'], 120000);

    mockProcess.emit('error', new Error('spawn ENOENT'));

    await expect(commandPromise).rejects.toThrow(
      'Erro ao executar o Claude CLI: spawn ENOENT',
    );
  });

  it('rejeita quando o spawn falha de forma síncrona', async () => {
    const claudeCliService = buildService();
    mockSpawn.mockImplementation(() => {
      throw new Error('binário não encontrado');
    });

    await expect(
      (
        claudeCliService as unknown as {
          runClaudeCommand: (
            claudeCommand: string,
            commandArguments: string[],
            timeoutMs: number,
          ) => Promise<string>;
        }
      ).runClaudeCommand('claude', ['-p', 'prompt'], 120000),
    ).rejects.toThrow(
      'Falha ao executar o Claude CLI (claude): binário não encontrado',
    );
  });

  it('encerra o processo, remove listeners e força SIGKILL após timeout', async () => {
    jest.useFakeTimers();

    const claudeCliService = buildService();
    const mockProcess = createMockClaudeProcess();
    mockSpawn.mockReturnValue(mockProcess as never);

    const commandPromise = (
      claudeCliService as unknown as {
        runClaudeCommand: (
          claudeCommand: string,
          commandArguments: string[],
          timeoutMs: number,
        ) => Promise<string>;
      }
    ).runClaudeCommand('claude', ['-p', 'prompt'], 100);

    expect(mockProcess.listenerCount('error')).toBe(1);
    expect(mockProcess.listenerCount('close')).toBe(1);
    expect(mockProcess.stdout.listenerCount('data')).toBe(1);
    expect(mockProcess.stderr.listenerCount('data')).toBe(1);

    jest.advanceTimersByTime(100);

    await expect(commandPromise).rejects.toThrow(
      'Claude CLI excedeu o tempo limite de 100ms.',
    );
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    expect(mockProcess.listenerCount('error')).toBe(0);
    expect(mockProcess.listenerCount('close')).toBe(0);
    expect(mockProcess.stdout.listenerCount('data')).toBe(0);
    expect(mockProcess.stderr.listenerCount('data')).toBe(0);

    jest.advanceTimersByTime(5000);

    expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
