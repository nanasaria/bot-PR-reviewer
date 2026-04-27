export const REVIEW_MODES = ['initial', 're-review'] as const;
export type ReviewModeModel = (typeof REVIEW_MODES)[number];
