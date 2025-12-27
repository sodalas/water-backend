import { pool } from '../../db.js';

export async function loadDraftForUser(userId) {
  const result = await pool.query(
    `
    select payload
    from composer_drafts
    where user_id = $1
    `,
    [userId]
  );
  if (result.rowCount === 0) return null;
  return result.rows[0];
}

export async function deleteDraftForUser(userId) {
  await pool.query(
    `delete from composer_drafts where user_id = $1`,
    [userId]
  );
}
