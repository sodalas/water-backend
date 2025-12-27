// domain/composer/Patch.js
import * as CSO from './CSO.js';

/**
 * Applies a single operation to a CSO, returning a NEW CSO.
 * Enforces all invariants. Throws on illegal transitions.
 */
export function apply(cso, op) {
  if (!cso || typeof cso !== 'object') throw new Error('Invalid CSO provided');
  if (!op || typeof op !== 'object') throw new Error('Invalid operation provided');

  // Clone to enforce immutability (shallow for root, deep for mutated props)
  const next = {
    ...cso,
    meta: { ...cso.meta }
  };

  switch (op.op) {
    case 'set_text':
      if (typeof op.value !== 'string') throw new Error('set_text value must be a string');
      next.text = op.value;
      break;

    case 'set_assertion_type':
      if (!CSO.INVARIANTS.isAssertionType(op.value)) {
        throw new Error(`Invalid assertion_type: ${op.value}`);
      }
      next.assertionType = op.value;
      break;

    case 'set_visibility':
      if (!CSO.INVARIANTS.isVisibility(op.value)) {
        throw new Error(`Invalid visibility: ${op.value}`);
      }
      next.visibility = op.value;
      break;

    case 'add_topic':
      if (typeof op.value !== 'string') throw new Error('add_topic value must be a string');
      if (!next.topics.includes(op.value)) {
        next.topics = [...next.topics, op.value];
      }
      break;

    case 'remove_topic':
      next.topics = next.topics.filter(t => t !== op.value);
      break;

    case 'add_mention':
      // Relaxed check: just ensure it is an object
      if (!op.value || typeof op.value !== 'object') throw new Error('add_mention value must be an object');
      next.mentions = [...next.mentions, op.value];
      break;

    case 'remove_mention':
       // Relaxed check: value assumed to be identifier
      next.mentions = next.mentions.filter(m => m.handle !== op.value);
      break;

    case 'add_ref':
       if (!op.value || typeof op.value !== 'object') throw new Error('add_ref value must be an object');
       next.refs = [...next.refs, op.value];
       break;

    case 'remove_ref':
       next.refs = next.refs.filter(r => r.uri !== op.value);
       break;

    case 'add_media':
       if (!op.value || typeof op.value !== 'object') throw new Error('add_media value must be an object');
       next.media = [...next.media, op.value];
       break;

    case 'remove_media':
       next.media = next.media.filter(m => m.src !== op.value);
       break;

    default:
      throw new Error(`Unknown operation: ${op.op}`);
  }

  return next;
}
