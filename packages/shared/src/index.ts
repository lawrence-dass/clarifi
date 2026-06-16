// @clarifi/shared — public surface shared across apps/web and apps/api.

export * from "./prisma.js";
export * from "./money.js";
export * from "./nl-query-ir.js";
export * from "./auth.js";
export * from "./canonical.js";

// Re-export Prisma enums/types so apps import domain types from one place.
export {
  Provider,
  AccountType,
  TransactionStatus,
  TransactionDirection,
  Category,
  CategorySource,
  AnomalyType,
  AnomalySeverity,
  ConsentStatus,
} from "./generated/prisma/client.js";
