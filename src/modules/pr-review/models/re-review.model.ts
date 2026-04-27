import { z } from 'zod';

export const ReReviewItemStatusSchema = z.enum([
  'corrigido',
  'parcialmente_corrigido',
  'nao_corrigido',
  'nao_aplicavel',
  'impossivel_validar',
]);

export const ReReviewItemSchema = z.object({
  originalComment: z.string().min(1),
  file: z.string().min(1),
  status: ReReviewItemStatusSchema,
  analysis: z.string().min(1),
  recommendedAction: z.string().min(1),
});

export const ReReviewSchema = z.object({
  overview: z.string().min(1),
  items: z.array(ReReviewItemSchema).default([]),
  confidence: z.enum(['high', 'medium', 'low']),
});

export type ReReviewItemStatus = z.infer<typeof ReReviewItemStatusSchema>;
export type ReReviewItem = z.infer<typeof ReReviewItemSchema>;
export type ReReview = z.infer<typeof ReReviewSchema>;

export interface ReReviewSummaryCounts {
  analyzed: number;
  corrigido: number;
  parcialmente_corrigido: number;
  nao_corrigido: number;
  nao_aplicavel: number;
  impossivel_validar: number;
}

export function summarizeReReviewItems(
  items: ReReviewItem[],
): ReReviewSummaryCounts {
  return {
    analyzed: items.length,
    corrigido: countByStatus(items, 'corrigido'),
    parcialmente_corrigido: countByStatus(items, 'parcialmente_corrigido'),
    nao_corrigido: countByStatus(items, 'nao_corrigido'),
    nao_aplicavel: countByStatus(items, 'nao_aplicavel'),
    impossivel_validar: countByStatus(items, 'impossivel_validar'),
  };
}

function countByStatus(items: ReReviewItem[], status: ReReviewItemStatus) {
  return items.filter((item) => item.status === status).length;
}
