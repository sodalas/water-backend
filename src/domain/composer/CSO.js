// domain/composer/CSO.js

export const ASSERTION_TYPES = {
  MOMENT: 'moment',
  NOTE: 'note',
  ARTICLE: 'article',
  ARTIFACT: 'artifact',
  RESPONSE: 'response',
  CURATION: 'curation'
};

export const VISIBILITY = {
  PUBLIC: 'public',
  FOLLOWERS: 'followers',
  UNLISTED: 'unlisted',
  PRIVATE: 'private'
};

const ASSERTION_TYPE_VALUES = Object.values(ASSERTION_TYPES);
const VISIBILITY_VALUES = Object.values(VISIBILITY);

export function createCSO(overrides = {}) {
  // Hard validation of overrides if provided
  if (overrides.assertionType && !ASSERTION_TYPE_VALUES.includes(overrides.assertionType)) {
    throw new Error(`Invalid assertionType: ${overrides.assertionType}`);
  }
  if (overrides.visibility && !VISIBILITY_VALUES.includes(overrides.visibility)) {
    throw new Error(`Invalid visibility: ${overrides.visibility}`);
  }

  return {
    title: typeof overrides.title === 'string' ? overrides.title : undefined,
    text: overrides.text || '',
    topics: Array.isArray(overrides.topics) ? [...overrides.topics] : [],
    mentions: Array.isArray(overrides.mentions) ? [...overrides.mentions] : [],
    refs: Array.isArray(overrides.refs) ? [...overrides.refs] : [],
    media: Array.isArray(overrides.media) ? [...overrides.media] : [],
    // Defaults
    assertionType: overrides.assertionType || ASSERTION_TYPES.NOTE,
    visibility: overrides.visibility || VISIBILITY.PRIVATE,
    meta: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides.meta
    }
  };
}

export const INVARIANTS = {
  isAssertionType: (val) => ASSERTION_TYPE_VALUES.includes(val),
  isVisibility: (val) => VISIBILITY_VALUES.includes(val)
};
