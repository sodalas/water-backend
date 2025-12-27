import { z } from "zod";

export const DRAFT_SCHEMA_VERSION = 1;

export const DraftEnvelopeSchemaV1 = z.object({
  clientId: z.string(),
  draft: z.record(z.any()), // Opaque JSON object
});
