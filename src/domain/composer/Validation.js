// domain/composer/Validation.js
import { ASSERTION_TYPES } from './CSO.js';

/**
 * Phase D.0 Contract Guard: Validates ref shape
 * Each ref must be { uri: string } with non-empty uri
 * @param {unknown} ref - The ref to validate
 * @returns {{ valid: boolean, error?: string }}
 */
function validateRefShape(ref) {
  if (typeof ref === 'string') {
    return { valid: false, error: 'Ref must be an object, not a string' };
  }
  if (ref === null || typeof ref !== 'object') {
    return { valid: false, error: 'Ref must be an object' };
  }
  if (typeof ref.uri !== 'string') {
    return { valid: false, error: 'Ref must have a uri property of type string' };
  }
  if (ref.uri.trim() === '') {
    return { valid: false, error: 'Ref uri cannot be empty' };
  }
  return { valid: true };
}

/**
 * Phase D.0 Contract Guard: Validates all refs in array
 * @param {unknown[]} refs - The refs array to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateRefs(refs) {
  if (!Array.isArray(refs)) {
    return { valid: false, errors: ['refs must be an array'] };
  }

  const errors = [];
  refs.forEach((ref, index) => {
    const result = validateRefShape(ref);
    if (!result.valid) {
      errors.push(`refs[${index}]: ${result.error}`);
    }
  });

  return { valid: errors.length === 0, errors };
}

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
      // Phase D.0 Contract Guard: Strict refs validation
      if (!hasRefs) {
        addError('ERR_RESPONSE_NO_TARGET', 'Response must reference a target', 'refs');
      } else {
        // Validate ref shapes: each must be { uri: string }
        const refsValidation = validateRefs(refs);
        if (!refsValidation.valid) {
          refsValidation.errors.forEach((err) => {
            addError('ERR_INVALID_REF_SHAPE', err, 'refs');
          });
        }
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
