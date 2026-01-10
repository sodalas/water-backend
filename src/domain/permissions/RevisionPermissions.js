// src/domain/permissions/RevisionPermissions.js
// Phase B1: Revision Canon B - Permission enforcement for revisions

/**
 * Valid user roles in Water
 * @typedef {'user' | 'admin' | 'super_admin'} UserRole
 */

/**
 * Check if a user can revise a specific assertion.
 *
 * Rules:
 * - admin and super_admin can revise any assertion
 * - user can only revise their own assertions
 * - guests (no user) cannot revise anything
 *
 * @param {{
 *   userId: string,
 *   role: UserRole,
 *   originalAuthorId: string
 * }} params
 * @returns {boolean}
 */
export function canUserReviseAssertion({ userId, role, originalAuthorId }) {
  if (!userId) {
    // Guest - no revisions allowed
    return false;
  }

  if (role === 'admin' || role === 'super_admin') {
    // Admins can revise any assertion
    return true;
  }

  if (role === 'user') {
    // Users can only revise their own assertions
    return userId === originalAuthorId;
  }

  // Unknown role - deny by default
  return false;
}

/**
 * Get user role from user object, defaulting to 'user'
 *
 * @param {any} user - User object from req.user
 * @returns {UserRole}
 */
export function getUserRole(user) {
  const role = user?.role;

  // Validate role
  if (role === 'admin' || role === 'super_admin' || role === 'user') {
    return role;
  }

  // Default to 'user' for safety
  return 'user';
}
