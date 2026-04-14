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
