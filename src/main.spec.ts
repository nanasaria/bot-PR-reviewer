describe('bootstrap', () => {
  type ValidationPipeSnapshot = {
    isTransformEnabled: boolean;
    validatorOptions: {
      whitelist: boolean;
      forbidNonWhitelisted: boolean;
    };
  };

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('configura ValidationPipe global e sobe a aplicação na porta configurada', async () => {
    const useGlobalPipesMock = jest.fn<void, [ValidationPipeSnapshot]>();
    const applicationMock = {
      useGlobalPipes: useGlobalPipesMock,
      get: jest.fn().mockReturnValue({
        get: jest.fn().mockReturnValue(4000),
      }),
      listen: jest.fn().mockResolvedValue(undefined),
    };
    const nestFactoryCreateMock = jest.fn().mockResolvedValue(applicationMock);
    const loggerLogMock = jest.fn();
    const nestCommon =
      jest.requireActual<typeof import('@nestjs/common')>('@nestjs/common');

    jest.doMock('@nestjs/core', () => ({
      NestFactory: {
        create: nestFactoryCreateMock,
      },
    }));
    jest.doMock('@nestjs/common', () => ({
      ...nestCommon,
      Logger: {
        log: loggerLogMock,
      },
    }));
    jest.doMock('./app.module', () => ({
      AppModule: class MockAppModule {},
    }));

    jest.isolateModules(() => {
      void jest.requireActual<typeof import('./main')>('./main');
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(nestFactoryCreateMock).toHaveBeenCalledTimes(1);
    const validationPipe = useGlobalPipesMock.mock.calls[0]?.[0];

    expect(validationPipe).toBeDefined();
    expect(validationPipe?.isTransformEnabled).toBe(true);
    expect(validationPipe?.validatorOptions).toMatchObject({
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(applicationMock.listen).toHaveBeenCalledWith(4000);
    expect(loggerLogMock).toHaveBeenCalledWith(
      'PR Review Bot ouvindo em http://localhost:4000',
      'Bootstrap',
    );
  });
});
