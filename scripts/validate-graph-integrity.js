/* eslint-disable no-console */
/**
 * READ-ONLY graph integrity validation.
 * Run after load tests to check for invariant violations.
 *
 * Checks:
 * 1. Duplicate reactions (idempotency violation)
 * 2. Orphaned SUPERSEDES edges
 * 3. Broken reply chains (replies without valid parent)
 * 4. Revision chain gaps
 *
 * IMPORTANT: This script performs READ-ONLY queries.
 * No data is modified or repaired.
 *
 * Run: node scripts/validate-graph-integrity.js
 */

import "dotenv/config";
import neo4j from "neo4j-driver";

const driver = neo4j.driver(
  process.env.NEO4J_URI || "bolt://localhost:7687",
  neo4j.auth.basic(
    process.env.NEO4J_USER || "neo4j",
    process.env.NEO4J_PASSWORD || "password"
  )
);

async function validateGraphIntegrity() {
  // Force read-only mode
  const session = driver.session({ defaultAccessMode: neo4j.session.READ });

  console.log("=== Graph Integrity Validation (READ-ONLY) ===\n");

  const results = {
    duplicateReactions: [],
    orphanedSupersedes: [],
    brokenReplyChains: [],
    revisionChainGaps: [],
    summary: {
      passed: true,
      violations: 0,
      warnings: 0,
    },
  };

  try {
    // 1. Duplicate reactions (CRITICAL - idempotency violation)
    console.log("1. Checking for duplicate reactions...");
    const duplicates = await session.run(`
      MATCH (u:Identity)-[r:REACTED_TO]->(a:Assertion)
      WITH u.id as userId, a.id as assertionId, r.type as reactionType, count(*) as cnt
      WHERE cnt > 1
      RETURN userId, assertionId, reactionType, cnt
      ORDER BY cnt DESC
      LIMIT 20
    `);

    if (duplicates.records.length > 0) {
      console.log("  ❌ VIOLATION: Duplicate reactions found:");
      duplicates.records.forEach((r) => {
        const record = {
          userId: r.get("userId"),
          assertionId: r.get("assertionId"),
          reactionType: r.get("reactionType"),
          count: r.get("cnt").toNumber(),
        };
        results.duplicateReactions.push(record);
        console.log(
          `    User ${record.userId} -> Assertion ${record.assertionId} (${record.reactionType}): ${record.count} edges`
        );
      });
      results.summary.passed = false;
      results.summary.violations += duplicates.records.length;
    } else {
      console.log("  ✓ No duplicate reactions");
    }

    // 2. Orphaned SUPERSEDES edges (CRITICAL - revision integrity)
    console.log("\n2. Checking for orphaned SUPERSEDES edges...");
    const orphaned = await session.run(`
      MATCH (newer:Assertion)-[:SUPERSEDES]->(older:Assertion)
      WHERE NOT EXISTS { MATCH (older)-[:AUTHORED_BY]->() }
      RETURN newer.id as newerId, older.id as olderId
      LIMIT 20
    `);

    if (orphaned.records.length > 0) {
      console.log("  ❌ VIOLATION: Orphaned SUPERSEDES edges found:");
      orphaned.records.forEach((r) => {
        const record = {
          newerId: r.get("newerId"),
          olderId: r.get("olderId"),
        };
        results.orphanedSupersedes.push(record);
        console.log(`    ${record.newerId} -> ${record.olderId} (older has no author)`);
      });
      results.summary.passed = false;
      results.summary.violations += orphaned.records.length;
    } else {
      console.log("  ✓ No orphaned SUPERSEDES edges");
    }

    // 3. Broken reply chains (WARNING - visibility may be intentional)
    console.log("\n3. Checking for broken reply chains...");
    const broken = await session.run(`
      MATCH (reply:Assertion {assertionType: 'response'})-[:RESPONDS_TO]->(parent:Assertion)
      WHERE parent.visibility = 'tombstone' OR parent.assertionType = 'tombstone'
      RETURN reply.id as replyId, parent.id as parentId, parent.visibility as parentVisibility
      LIMIT 20
    `);

    if (broken.records.length > 0) {
      console.log("  ⚠️  WARNING: Replies to tombstoned/hidden parents found:");
      broken.records.forEach((r) => {
        const record = {
          replyId: r.get("replyId"),
          parentId: r.get("parentId"),
          parentVisibility: r.get("parentVisibility"),
        };
        results.brokenReplyChains.push(record);
        console.log(
          `    Reply ${record.replyId} -> Parent ${record.parentId} (${record.parentVisibility})`
        );
      });
      results.summary.warnings += broken.records.length;
      // Note: This is a warning, not a violation - tombstoning is valid behavior
    } else {
      console.log("  ✓ No broken reply chains");
    }

    // 4. Revision chain gaps (CRITICAL - version integrity)
    console.log("\n4. Checking for revision chain gaps...");

    // First, find assertions with revision numbers
    const revisionedAssertions = await session.run(`
      MATCH (a:Assertion)
      WHERE a.revisionNumber IS NOT NULL AND a.rootAssertionId IS NOT NULL
      WITH a.rootAssertionId as rootId, collect(a.revisionNumber) as revisions
      WHERE size(revisions) > 1
      RETURN rootId, revisions
      ORDER BY size(revisions) DESC
      LIMIT 50
    `);

    let gapCount = 0;
    for (const record of revisionedAssertions.records) {
      const rootId = record.get("rootId");
      const revisions = record.get("revisions").map((r) =>
        typeof r.toNumber === "function" ? r.toNumber() : r
      );

      // Check for gaps in revision sequence
      const sortedRevisions = [...revisions].sort((a, b) => a - b);
      const maxRevision = sortedRevisions[sortedRevisions.length - 1];
      const expectedRevisions = Array.from({ length: maxRevision }, (_, i) => i + 1);
      const missingRevisions = expectedRevisions.filter((r) => !revisions.includes(r));

      if (missingRevisions.length > 0) {
        const gapRecord = {
          rootId,
          revisions: sortedRevisions,
          missing: missingRevisions,
        };
        results.revisionChainGaps.push(gapRecord);
        console.log(`  ❌ VIOLATION: Root ${rootId}`);
        console.log(`    Has: [${sortedRevisions.join(", ")}]`);
        console.log(`    Missing: [${missingRevisions.join(", ")}]`);
        gapCount++;
      }
    }

    if (gapCount === 0) {
      console.log("  ✓ No revision chain gaps");
    } else {
      results.summary.passed = false;
      results.summary.violations += gapCount;
    }

    // Summary statistics
    console.log("\n5. Collecting graph statistics...");
    const stats = await session.run(`
      MATCH (a:Assertion)
      WITH count(a) as totalAssertions
      MATCH (r:Assertion {assertionType: 'response'})
      WITH totalAssertions, count(r) as totalResponses
      MATCH ()-[react:REACTED_TO]->()
      WITH totalAssertions, totalResponses, count(react) as totalReactions
      MATCH ()-[sup:SUPERSEDES]->()
      RETURN totalAssertions, totalResponses, totalReactions, count(sup) as totalSupersedes
    `);

    if (stats.records.length > 0) {
      const s = stats.records[0];
      console.log("  Graph statistics:");
      console.log(`    Total assertions: ${s.get("totalAssertions")}`);
      console.log(`    Total responses: ${s.get("totalResponses")}`);
      console.log(`    Total reactions: ${s.get("totalReactions")}`);
      console.log(`    Total SUPERSEDES: ${s.get("totalSupersedes")}`);
    }

    // Final summary
    console.log("\n=== Validation Complete ===\n");

    if (results.summary.passed && results.summary.warnings === 0) {
      console.log("✅ All checks passed - graph integrity verified");
    } else if (results.summary.passed) {
      console.log(
        `⚠️  Passed with ${results.summary.warnings} warning(s) - review recommended`
      );
    } else {
      console.log(
        `❌ FAILED - ${results.summary.violations} violation(s) found`
      );
      console.log("   Review violations above and investigate root causes");
    }

    console.log("\nDetailed results (JSON):");
    console.log(JSON.stringify(results, null, 2));

    return results;
  } finally {
    await session.close();
    await driver.close();
  }
}

validateGraphIntegrity()
  .then((results) => {
    process.exit(results.summary.passed ? 0 : 1);
  })
  .catch((err) => {
    console.error("❌ Validation failed with error:", err);
    process.exit(1);
  });
