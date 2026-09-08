import { z } from "zod";

// Keep the legacy data array; new clients use the sibling pagination metadata.
export const operationsPageSchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  status: z.string().trim().min(1).max(64).optional(),
});
