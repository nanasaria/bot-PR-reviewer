import { z } from 'zod';

export const ClaudeReviewDecisionSchema = z.enum([
  'APPROVE',
  'REQUEST_CHANGES',
  'COMMENT',
]);
export const ClaudeIssueSeveritySchema = z.enum(['high', 'medium', 'low']);
export const ClaudeReviewConfidenceSchema = z.enum(['high', 'medium', 'low']);

export const ClaudeIssueSchema = z.object({
  severity: ClaudeIssueSeveritySchema,
  file: z.string().min(1),
  reason: z.string().min(1),
});

export const ClaudeReviewSchema = z.object({
  decision: ClaudeReviewDecisionSchema,
  body: z.string().min(1),
  issues: z.array(ClaudeIssueSchema).default([]),
  confidence: ClaudeReviewConfidenceSchema,
});

export type ClaudeReview = z.infer<typeof ClaudeReviewSchema>;
export type ClaudeIssue = z.infer<typeof ClaudeIssueSchema>;
export type ClaudeReviewDecision = z.infer<typeof ClaudeReviewDecisionSchema>;
export type ClaudeIssueSeverity = z.infer<typeof ClaudeIssueSeveritySchema>;
export type ClaudeReviewConfidence = z.infer<
  typeof ClaudeReviewConfidenceSchema
>;
