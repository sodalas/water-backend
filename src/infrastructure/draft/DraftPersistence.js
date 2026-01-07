import { pool } from '../../db.js';

/**
 * Load draft for user
 * @param {string} userId
 * @returns {Promise<{ payload: any } | null>}
 */
export async function loadDraftForUser(userId) {
  const result = await pool.query(
    `
    select schema_version, payload, updated_at
    from composer_drafts
    where user_id = $1
    `,
    [userId]
  );
  if (result.rowCount === 0) return null;
  return result.rows[0];
}

/**
 * Save or update draft for user
 * @param {string} userId
 * @param {object} draft - Draft payload (will be JSON stringified)
 * @param {string} schemaVersion - Draft schema version
 * @param {string | null} clientId - Optional client identifier
 * @returns {Promise<{ schemaVersion: string, draft: any, updatedAt: Date }>}
 */
export async function saveDraftForUser(userId, draft, schemaVersion, clientId = null) {
  await pool.query(
    `
    insert into composer_drafts (
      user_id,
      schema_version,
      client_id,
      payload,
      updated_at
    )
    values ($1, $2, $3, $4, now())
    on conflict (user_id)
    do update set
      schema_version = excluded.schema_version,
      client_id = excluded.client_id,
      payload = excluded.payload,
      updated_at = now()
    returning updated_at
    `,
    [
      userId,
      schemaVersion,
      clientId,
      JSON.stringify(draft),
    ]
  );

  return {
    schemaVersion,
    draft,
    updatedAt: new Date(),
  };
}

/**
 * Delete draft for user
 * @param {string} userId
 * @returns {Promise<void>}
 */
export async function deleteDraftForUser(userId) {
  await pool.query(
    `delete from composer_drafts where user_id = $1`,
    [userId]
  );
}
