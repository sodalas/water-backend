// domain/reactions/ReactionTypes.js

/**
 * Phase E.1: Reaction Types
 *
 * Defines the allowed reaction types for the Water platform.
 * These are enumerable and explicit per canon requirements.
 */

export const REACTION_TYPES = {
  LIKE: 'like',
  ACKNOWLEDGE: 'acknowledge'
};

/**
 * Validate that a reaction type is allowed
 * @param {string} type - The reaction type to validate
 * @returns {boolean} - True if valid, false otherwise
 */
export function isValidReactionType(type) {
  return Object.values(REACTION_TYPES).includes(type);
}

/**
 * Get all valid reaction types as an array
 * @returns {string[]} - Array of valid reaction type values
 */
export function getAllReactionTypes() {
  return Object.values(REACTION_TYPES);
}
