import { z } from "zod";
export const referenceDocumentSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(500),
  type: z.enum(["pdf", "docx", "txt"]),
  size: z
    .number()
    .int()
    .nonnegative()
    .max(10 * 1024 * 1024),
  createdAt: z.string(),
});
export const referenceTextSchema = referenceDocumentSchema.extend({
  text: z.string().min(1).max(150000),
});
export type ReferenceDocument = z.infer<typeof referenceDocumentSchema>;
export const referenceStorageKey = (id: string) => `reference:${id}`;
