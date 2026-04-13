import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ReviewPrRequestModel } from './review-pr-request.model';

describe('ReviewPrRequestModel', () => {
  it('aceita URL de PR do GitHub e normaliza espaços extras', () => {
    const reviewPrRequestModel = plainToInstance(ReviewPrRequestModel, {
      prUrl: '  https://github.com/acme/widgets/pull/42  ',
    });

    const validationErrors = validateSync(reviewPrRequestModel);

    expect(validationErrors).toHaveLength(0);
    expect(reviewPrRequestModel.prUrl).toBe(
      'https://github.com/acme/widgets/pull/42',
    );
  });

  it('rejeita URL que não é um PR do GitHub', () => {
    const reviewPrRequestModel = plainToInstance(ReviewPrRequestModel, {
      prUrl: 'https://example.com/pull/42',
    });

    const validationErrors = validateSync(reviewPrRequestModel);
    const urlValidationMessage = validationErrors[0]?.constraints?.matches;

    expect(validationErrors).toHaveLength(1);
    expect(urlValidationMessage).toContain(
      'URL de Pull Request do GitHub válida',
    );
  });
});
