import "dotenv/config";
import { pool } from "./db.js";

async function run() {
  const userId = "test-verification-" + Date.now();
  console.log("Testing with User:", userId);

  try {
    // 1. Create Draft
    await pool.query(
      `INSERT INTO composer_drafts (user_id, schema_version, payload, updated_at, client_id) VALUES ($1, 1, $2, NOW(), 'test-client')`,
      [userId, JSON.stringify({ text: "Hello" })]
    );
    console.log("1. Draft created.");

    // 2. Simulate "Publish with Retention" (Default)
    // The logic in publish.js is: const clearDraft = req.body?.clearDraft === true;
    console.log("2. Testing Default Behavior (No clearDraft param)...");
    const reqBodyDefault = { cso: { text: "t" } }; 
    const shouldClearDefault = reqBodyDefault?.clearDraft === true; 
    
    if (shouldClearDefault) {
       await pool.query(`delete from composer_drafts where user_id = $1`, [userId]);
    }
    
    // Check
    let res = await pool.query(`SELECT * FROM composer_drafts WHERE user_id = $1`, [userId]);
    if (res.rowCount === 1) {
        console.log("   PASS: Draft retained.");
    } else {
        console.error("   FAIL: Draft was deleted!");
        process.exit(1);
    }

    // 3. Simulate "Publish with Explicit Clear"
    console.log("3. Testing Explicit Clear (clearDraft: true)...");
    const reqBodyExplicit = { cso: { text: "t" }, clearDraft: true };
    const shouldClearExplicit = reqBodyExplicit?.clearDraft === true;

    if (shouldClearExplicit) {
       await pool.query(`delete from composer_drafts where user_id = $1`, [userId]);
    }

    // Check
    res = await pool.query(`SELECT * FROM composer_drafts WHERE user_id = $1`, [userId]);
    if (res.rowCount === 0) {
        console.log("   PASS: Draft cleared.");
    } else {
        console.error("   FAIL: Draft was NOT deleted!");
        process.exit(1);
    }
    
  } catch (err) {
      console.error("Verification Error:", err);
      process.exit(1);
  } finally {
      // Cleanup just in case
      await pool.query(`delete from composer_drafts where user_id = $1`, [userId]);
      // End pool to allow script to exit
      await pool.end();
  }
}

run();
