// domain/composer/Validation.js
import { ASSERTION_TYPES } from './CSO.js';

/**
 * Validates a CSO for structural semantic coherence.
 * Returns { ok: boolean, errors: [], warnings: [] }
 */
export function validate(cso) {
  const result = {
    ok: true,
    errors: [],
    warnings: []
  };

  if (!cso) {
    result.errors.push({ code: 'ERR_NO_CSO', message: 'CSO is missing' });
    result.ok = false;
    return result;
  }

  // Helper to push error
  const addError = (code, message, path) => {
    result.errors.push({ code, message, path });
    result.ok = false;
  };

  const { assertionType, title, text, refs, media, originPublicationId } = cso;
  
  const hasText = typeof text === 'string' && text.trim().length > 0;
  const hasMedia = Array.isArray(media) && media.length > 0;
  const hasRefs = Array.isArray(refs) && refs.length > 0;

  // --- Universal Structural Integrity ---
  // An assertion must assert *something*. 
  // Empty text + No Media = Void.
  if (!hasText && !hasMedia) {
     addError('ERR_EMPTY_ASSERTION', 'Assertion must contain text or media', 'text');
  }

  // --- Type-Specific Definitions ---

  switch (assertionType) {
    case ASSERTION_TYPES.RESPONSE:
      // Definition: A response is a reply to a target.
      if (!hasRefs) {
        addError('ERR_RESPONSE_NO_TARGET', 'Response must reference a target', 'refs');
      }
      break;

    case ASSERTION_TYPES.CURATION:
      // Definition: A curation points to or collects content.
      if (!hasRefs && !hasMedia) {
        addError('ERR_CURATION_EMPTY', 'Curation must reference content or embed media', 'refs');
      }
      break;

    default:
      // Moment, Note, Artifact have no additional structural constraints 
      // beyond "not being empty".
      break;
  }

  return result;
}
