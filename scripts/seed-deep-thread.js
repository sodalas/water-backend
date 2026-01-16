/* eslint-disable no-console */
/**
 * Seeds a deep thread for Scenario D load testing.
 * Run: node scripts/seed-deep-thread.js
 *
 * Creates:
 * - 1 root assertion with known ID (loadtest-deep-root)
 * - 500 responses nested up to 50 levels deep
 *
 * Structure:
 * - Root assertion
 * - 10 direct replies to root (level 1)
 * - Each level-1 reply has 10 nested replies (level 2)
 * - Continue with ~10 replies per level up to level 50
 *
 * This creates a realistic deep conversation structure for thread traversal testing.
 */

import "dotenv/config";
import neo4j from "neo4j-driver";

// Configuration
const ROOT_ID = "loadtest-deep-root";
const THREAD_OWNER = "loadtest-user-1";
const TARGET_RESPONSES = 500;
const MAX_DEPTH = 50;

const driver = neo4j.driver(
  process.env.NEO4J_URI || "bolt://localhost:7687",
  neo4j.auth.basic(
    process.env.NEO4J_USER || "neo4j",
    process.env.NEO4J_PASSWORD || "password"
  )
);

async function cleanupExistingThread() {
  console.log("🧹 Cleaning up existing deep thread...");

  const session = driver.session();
  try {
    // Delete all assertions in the deep thread
    await session.run(
      `
      MATCH (a:Assertion)
      WHERE a.id STARTS WITH 'loadtest-deep-'
      DETACH DELETE a
      `
    );
    console.log("✅ Cleanup complete");
  } finally {
    await session.close();
  }
}

async function ensureTestUsersExist() {
  console.log("📝 Ensuring test users exist...");

  const session = driver.session();
  try {
    // Create 100 test users (same as seed-load-test-data.js)
    for (let i = 1; i <= 100; i++) {
      await session.run(
        `
        MERGE (u:Identity {id: $userId})
        ON CREATE SET u.handle = $handle, u.displayName = $displayName
        `,
        {
          userId: `loadtest-user-${i}`,
          handle: `testuser${i}`,
          displayName: `Test User ${i}`,
        }
      );
    }
    console.log("✅ Test users ready");
  } finally {
    await session.close();
  }
}

async function createRootAssertion() {
  console.log(`📝 Creating root assertion: ${ROOT_ID}`);

  const session = driver.session();
  try {
    await session.run(
      `
      MERGE (a:Assertion {id: $rootId})
      ON CREATE SET
        a.assertionType = 'moment',
        a.text = 'Deep thread root for load testing - Scenario D',
        a.visibility = 'public',
        a.createdAt = datetime(),
        a.updatedAt = datetime()
      WITH a
      MATCH (u:Identity {id: $userId})
      MERGE (a)-[:AUTHORED_BY]->(u)
      `,
      {
        rootId: ROOT_ID,
        userId: THREAD_OWNER,
      }
    );
    console.log("✅ Root assertion created");
  } finally {
    await session.close();
  }
}

async function createResponses() {
  console.log(`📝 Creating ${TARGET_RESPONSES} nested responses...`);

  let responseCount = 0;
  const parentIds = [ROOT_ID];
  let currentLevelParents = [ROOT_ID];
  let level = 1;

  while (responseCount < TARGET_RESPONSES && level <= MAX_DEPTH) {
    const nextLevelParents = [];

    // Calculate how many replies at this level
    // Distribute responses evenly across levels with slight randomness
    const responsesThisLevel = Math.min(
      Math.ceil((TARGET_RESPONSES - responseCount) / (MAX_DEPTH - level + 1)),
      currentLevelParents.length * 2 // Max 2 replies per parent at each level
    );

    for (let i = 0; i < responsesThisLevel && responseCount < TARGET_RESPONSES; i++) {
      const parentId = currentLevelParents[i % currentLevelParents.length];
      const responseId = `loadtest-deep-response-${responseCount + 1}`;
      const userId = `loadtest-user-${(responseCount % 100) + 1}`;

      const session = driver.session();
      try {
        await session.run(
          `
          CREATE (r:Assertion {
            id: $responseId,
            assertionType: 'response',
            text: $text,
            visibility: 'public',
            createdAt: datetime(),
            updatedAt: datetime(),
            depth: $depth
          })
          WITH r
          MATCH (parent:Assertion {id: $parentId})
          MATCH (u:Identity {id: $userId})
          MERGE (r)-[:RESPONDS_TO]->(parent)
          MERGE (r)-[:AUTHORED_BY]->(u)
          `,
          {
            responseId,
            parentId,
            userId,
            text: `Deep thread response at level ${level}, index ${i}`,
            depth: level,
          }
        );
        nextLevelParents.push(responseId);
        responseCount++;
      } catch (err) {
        console.error(`Failed to create response ${responseId}: ${err.message}`);
      } finally {
        await session.close();
      }
    }

    if (responseCount % 50 === 0) {
      console.log(`  ... ${responseCount}/${TARGET_RESPONSES} responses created (level ${level})`);
    }

    currentLevelParents = nextLevelParents;
    level++;

    // If we run out of parents, restart from a random selection
    if (currentLevelParents.length === 0 && responseCount < TARGET_RESPONSES) {
      currentLevelParents = parentIds.slice(-20); // Take last 20 responses as new parents
    }

    parentIds.push(...nextLevelParents);
  }

  console.log(`✅ Created ${responseCount} responses across ${level - 1} levels`);
  return responseCount;
}

async function verifyThread() {
  console.log("\n📊 Verifying thread structure...");

  const session = driver.session();
  try {
    // Count total responses
    const countResult = await session.run(
      `
      MATCH (r:Assertion {assertionType: 'response'})
      WHERE r.id STARTS WITH 'loadtest-deep-response-'
      RETURN count(r) as total
      `
    );
    const total = countResult.records[0].get("total").toNumber();
    console.log(`  Total responses: ${total}`);

    // Get depth distribution
    const depthResult = await session.run(
      `
      MATCH (r:Assertion {assertionType: 'response'})
      WHERE r.id STARTS WITH 'loadtest-deep-response-'
      RETURN r.depth as depth, count(*) as count
      ORDER BY depth
      LIMIT 10
      `
    );
    console.log("  Depth distribution (first 10 levels):");
    depthResult.records.forEach((r) => {
      console.log(`    Level ${r.get("depth")}: ${r.get("count")} responses`);
    });

    // Get max depth
    const maxDepthResult = await session.run(
      `
      MATCH (r:Assertion {assertionType: 'response'})
      WHERE r.id STARTS WITH 'loadtest-deep-response-'
      RETURN max(r.depth) as maxDepth
      `
    );
    const maxDepth = maxDepthResult.records[0].get("maxDepth");
    console.log(`  Maximum depth: ${maxDepth}`);

    return { total, maxDepth };
  } finally {
    await session.close();
  }
}

async function main() {
  console.log("🌊 Water Deep Thread Seeder (Scenario D)\n");

  try {
    await cleanupExistingThread();
    await ensureTestUsersExist();
    await createRootAssertion();
    const responseCount = await createResponses();
    const stats = await verifyThread();

    console.log("\n✅ Deep thread seeded successfully!");
    console.log("\nThread details:");
    console.log(`  Root ID: ${ROOT_ID}`);
    console.log(`  Total responses: ${stats.total}`);
    console.log(`  Maximum depth: ${stats.maxDepth}`);
    console.log("\nTo run Scenario D:");
    console.log(`  THREAD_ID=${ROOT_ID} npm run loadtest:scenario-d`);
  } catch (err) {
    console.error("❌ Failed to seed deep thread:", err);
    process.exit(1);
  } finally {
    await driver.close();
  }
}

main();
