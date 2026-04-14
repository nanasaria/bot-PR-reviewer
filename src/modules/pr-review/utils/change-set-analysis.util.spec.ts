import { analyzePullRequestChangeSet } from './change-set-analysis.util';

describe('analyzePullRequestChangeSet', () => {
  it('trata arquivos Angular em repositório webapp como front-end, sem marcar back-end', () => {
    const analysis = analyzePullRequestChangeSet(
      [
        {
          filename: 'src/app/core/services/analytics.service.ts',
          status: 'modified',
          additions: 10,
          deletions: 2,
          changes: 12,
        },
      ],
      'webapp',
    );

    expect(analysis.hasFrontendChanges).toBe(true);
    expect(analysis.hasBackendChanges).toBe(false);
    expect(analysis.hasTestFiles).toBe(false);
  });

  it('reconhece pacote server do orc-lite como back-end', () => {
    const analysis = analyzePullRequestChangeSet(
      [
        {
          filename: 'packages/server/src/modules/auth/auth.service.ts',
          status: 'modified',
          additions: 20,
          deletions: 3,
          changes: 23,
        },
      ],
      'orc-lite',
    );

    expect(analysis.hasBackendChanges).toBe(true);
    expect(analysis.backendFiles).toEqual([
      'packages/server/src/modules/auth/auth.service.ts',
    ]);
    expect(analysis.hasFrontendChanges).toBe(false);
  });

  it('classifica arquivo .service.ts como back-end em repositório desconhecido', () => {
    const analysis = analyzePullRequestChangeSet(
      [
        {
          filename: 'src/modules/auth/auth.service.ts',
          status: 'modified',
          additions: 5,
          deletions: 2,
          changes: 7,
        },
      ],
      'new-service',
    );

    expect(analysis.hasBackendChanges).toBe(true);
    expect(analysis.backendFiles).toEqual(['src/modules/auth/auth.service.ts']);
  });

  it('classifica corretamente quando repositoryName é undefined', () => {
    const analysis = analyzePullRequestChangeSet(
      [
        {
          filename: 'src/controllers/user.controller.ts',
          status: 'added',
          additions: 30,
          deletions: 0,
          changes: 30,
        },
      ],
      undefined,
    );

    expect(analysis.hasBackendChanges).toBe(true);
    expect(analysis.backendFiles).toEqual([
      'src/controllers/user.controller.ts',
    ]);
  });

  it('arquivo de teste em diretório de back-end não é classificado como back-end', () => {
    const analysis = analyzePullRequestChangeSet(
      [
        {
          filename: 'src/modules/auth/auth.service.spec.ts',
          status: 'modified',
          additions: 10,
          deletions: 0,
          changes: 10,
        },
      ],
      'server',
    );

    expect(analysis.hasBackendChanges).toBe(false);
    expect(analysis.hasTestFiles).toBe(true);
    expect(analysis.backendFiles).toEqual([]);
  });

  it('reconhece extensões variadas como back-end (.py, .rs, .go)', () => {
    const analysis = analyzePullRequestChangeSet([
      {
        filename: 'src/handlers/payment.py',
        status: 'added',
        additions: 20,
        deletions: 0,
        changes: 20,
      },
      {
        filename: 'src/services/order.rs',
        status: 'modified',
        additions: 8,
        deletions: 3,
        changes: 11,
      },
      {
        filename: 'src/api/health.go',
        status: 'added',
        additions: 15,
        deletions: 0,
        changes: 15,
      },
    ]);

    expect(analysis.hasBackendChanges).toBe(true);
    expect(analysis.backendFiles).toEqual([
      'src/handlers/payment.py',
      'src/services/order.rs',
      'src/api/health.go',
    ]);
  });

  it('reconhece BACKEND_MONOREPO_PACKAGE_PATTERN', () => {
    const analysis = analyzePullRequestChangeSet(
      [
        {
          filename: 'packages/public-api/src/routes/users.ts',
          status: 'modified',
          additions: 10,
          deletions: 2,
          changes: 12,
        },
        {
          filename: 'packages/crons/src/jobs/sync.ts',
          status: 'added',
          additions: 25,
          deletions: 0,
          changes: 25,
        },
      ],
      'orc-lite',
    );

    expect(analysis.hasBackendChanges).toBe(true);
    expect(analysis.backendFiles).toContain(
      'packages/public-api/src/routes/users.ts',
    );
    expect(analysis.backendFiles).toContain('packages/crons/src/jobs/sync.ts');
  });

  it('reconhece pacote webapp do orc-lite como front-end', () => {
    const analysis = analyzePullRequestChangeSet(
      [
        {
          filename: 'packages/webapp/src/app/pages/home/home.component.ts',
          status: 'modified',
          additions: 14,
          deletions: 1,
          changes: 15,
        },
      ],
      'orc-lite',
    );

    expect(analysis.hasFrontendChanges).toBe(true);
    expect(analysis.hasBackendChanges).toBe(false);
  });
});
