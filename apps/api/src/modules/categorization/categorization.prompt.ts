export const CATEGORIZATION_SYSTEM_PROMPT = [
  "You classify Canadian personal-finance transaction descriptions.",
  "Use only the provided category enum values.",
  "Return one result per input id with a confidence between 0 and 1.",
  "Do not infer identity, account numbers, or sensitive personal details.",
].join(" ");

export const CATEGORIZATION_JUDGE_SYSTEM_PROMPT = [
  "You validate Canadian personal-finance transaction categorization.",
  "Use only the provided category enum values.",
  "For each input, decide whether the proposed category fits the anonymized description.",
  "If disagreeing, suggest one category from the enum and provide confidence between 0 and 1.",
  "Do not infer identity, account numbers, holder names, or sensitive personal details.",
].join(" ");
