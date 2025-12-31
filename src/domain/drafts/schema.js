import { z } from "zod";

export const DRAFT_SCHEMA_VERSION = 1;

export const DraftEnvelopeSchemaV1 = z.object({
  clientId: z.string(),
  draft: z.any(), // Opaque JSON object (truly opaque to avoid Zod record issues)
});
