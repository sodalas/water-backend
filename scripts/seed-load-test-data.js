/* eslint-disable no-console */
/**
 * Seeds database with load test data.
 * Run: node scripts/seed-load-test-data.js
 *
 * Creates:
 * - 100 test users
 * - 1000 root assertions (mixed public/private)
 * - 500 responses (replies)
 * - 200 reaction edges
 * - 50 revision chains (SUPERSEDES edges)
 */

import "dotenv/config";
import pg from "pg";
import neo4j from "neo4j-driver";
import { Neo4jGraphAdapter } from "../src/infrastructure/graph/Neo4jGraphAdapter.js";
import { ASSERTION_TYPES, VISIBILITY } from "../src/domain/composer/CSO.js";

const { Pool } = pg;

// Configuration
const NUM_USERS = 100;
const NUM_ROOT_ASSERTIONS = 1000;
const NUM_RESPONSES = 500;
const NUM_REACTIONS = 200;
const NUM_REVISION_CHAINS = 50;

// Test user ID prefix
const USER_PREFIX = "loadtest-user-";

// Initialize connections
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const neo4jAdapter = new Neo4jGraphAdapter({
  uri: process.env.NEO4J_URI || "bolt://localhost:7687",
  user: process.env.NEO4J_USER || "neo4j",
  password: process.env.NEO4J_PASSWORD || "password",
});

const driver = neo4j.driver(
  process.env.NEO4J_URI || "bolt://localhost:7687",
  neo4j.auth.basic(
    process.env.NEO4J_USER || "neo4j",
    process.env.NEO4J_PASSWORD || "password"
  )
);

// Utility functions
function cryptoRandomId(prefix) {
  const r =
    globalThis.crypto?.randomUUID?.() ??
    `${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  return `${prefix}_${r}`;
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Seeding functions
async function createTestUsers() {
  console.log(`📝 Creating ${NUM_USERS} test users...`);
  const client = await pool.connect();

  try {
    for (let i = 1; i <= NUM_USERS; i++) {
      const userId = `${USER_PREFIX}${i}`;
      const email = `loadtest-${i}@test.local`;

      await client.query(
        `
        INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, true, NOW(), NOW())
        ON CONFLICT (email) DO NOTHING
        `,
        [userId, `Test User ${i}`, email]
      );

      // Also create Identity node in Neo4j
      const session = driver.session();
      try {
        await session.run(
          `
          MERGE (u:Identity {id: $userId})
          ON CREATE SET u.handle = $handle, u.displayName = $displayName
          `,
          {
            userId,
            handle: `testuser${i}`,
            displayName: `Test User ${i}`,
          }
        );
      } finally {
        await session.close();
      }
    }

    console.log(`✅ Created ${NUM_USERS} test users`);
  } finally {
    client.release();
  }
}

async function createRootAssertions() {
  console.log(`📝 Creating ${NUM_ROOT_ASSERTIONS} root assertions...`);

  const assertionIds = [];
  const assertionTypes = [
    ASSERTION_TYPES.MOMENT,
    ASSERTION_TYPES.NOTE,
    ASSERTION_TYPES.ARTICLE,
  ];

  for (let i = 0; i < NUM_ROOT_ASSERTIONS; i++) {
    const userId = `${USER_PREFIX}${randomInt(1, NUM_USERS)}`;
    const assertionType = randomChoice(assertionTypes);
    const isPublic = Math.random() < 0.8; // 80% public
    const visibility = isPublic ? VISIBILITY.PUBLIC : VISIBILITY.PRIVATE;

    const cso = {
      assertionType,
      text: `Load test ${assertionType} content #${i}`,
      title: assertionType === ASSERTION_TYPES.ARTICLE ? `Article ${i}` : undefined,
      visibility,
      topics: Math.random() < 0.3 ? [`topic${randomInt(1, 20)}`] : [],
      mentions: [],
      refs: [],
      media: [],
      meta: {
        createdAt: new Date(Date.now() - randomInt(0, 86400000 * 30)).toISOString(), // Random within last 30 days
      },
    };

    const viewer = {
      id: userId,
      handle: `testuser${userId.replace(USER_PREFIX, "")}`,
      displayName: `Test User ${userId.replace(USER_PREFIX, "")}`,
    };

    const result = await neo4jAdapter.publish({ viewer, cso });
    assertionIds.push(result.assertionId);
  }

  console.log(`✅ Created ${NUM_ROOT_ASSERTIONS} root assertions`);
  return assertionIds;
}

async function createResponses(rootAssertionIds) {
  console.log(`📝 Creating ${NUM_RESPONSES} responses...`);

  const responseIds = [];

  for (let i = 0; i < NUM_RESPONSES; i++) {
    const userId = `${USER_PREFIX}${randomInt(1, NUM_USERS)}`;
    const parentId = randomChoice(rootAssertionIds);

    const cso = {
      assertionType: ASSERTION_TYPES.RESPONSE,
      text: `Load test response #${i}`,
      visibility: VISIBILITY.PUBLIC,
      topics: [],
      mentions: [],
      refs: [{ uri: `water://assertion/${parentId}` }],
      media: [],
      meta: {
        createdAt: new Date(Date.now() - randomInt(0, 86400000 * 20)).toISOString(), // Random within last 20 days
      },
    };

    const viewer = {
      id: userId,
      handle: `testuser${userId.replace(USER_PREFIX, "")}`,
      displayName: `Test User ${userId.replace(USER_PREFIX, "")}`,
    };

    const result = await neo4jAdapter.publish({ viewer, cso });
    responseIds.push(result.assertionId);
  }

  console.log(`✅ Created ${NUM_RESPONSES} responses`);
  return responseIds;
}

async function createReactions(allAssertionIds) {
  console.log(`📝 Creating ${NUM_REACTIONS} reactions...`);

  const reactionTypes = ["like", "love", "insightful"];

  for (let i = 0; i < NUM_REACTIONS; i++) {
    const userId = `${USER_PREFIX}${randomInt(1, NUM_USERS)}`;
    const assertionId = randomChoice(allAssertionIds);
    const reactionType = randomChoice(reactionTypes);

    try {
      await neo4jAdapter.addReaction(userId, assertionId, reactionType);
    } catch (err) {
      // Ignore failures (might be visibility issues or duplicates)
      console.log(`⚠️  Reaction ${i} failed: ${err.message}`);
    }
  }

  console.log(`✅ Created reactions (some may have been skipped)`);
}

async function createRevisionChains(rootAssertionIds) {
  console.log(`📝 Creating ${NUM_REVISION_CHAINS} revision chains...`);

  for (let i = 0; i < NUM_REVISION_CHAINS; i++) {
    const originalId = randomChoice(rootAssertionIds);
    const numRevisions = randomInt(2, 5);

    // Get original assertion data
    const session = driver.session();
    let originalData;
    try {
      const result = await session.run(
        `
        MATCH (a:Assertion {id: $id})-[:AUTHORED_BY]->(u:Identity)
        RETURN a, u
        `,
        { id: originalId }
      );

      if (result.records.length === 0) continue;

      const record = result.records[0];
      const assertion = record.get("a").properties;
      const identity = record.get("u").properties;

      originalData = { assertion, identity };
    } finally {
      await session.close();
    }

    let previousId = originalId;
    let rootAssertionId = originalId;

    for (let rev = 1; rev <= numRevisions; rev++) {
      const cso = {
        assertionType: originalData.assertion.assertionType,
        text: `${originalData.assertion.text} [REVISION ${rev}]`,
        title: originalData.assertion.title,
        visibility: originalData.assertion.visibility,
        topics: [],
        mentions: [],
        refs: [],
        media: [],
        meta: {
          createdAt: new Date(
            new Date(originalData.assertion.createdAt).getTime() + rev * 3600000
          ).toISOString(),
        },
      };

      const viewer = {
        id: originalData.identity.id,
        handle: originalData.identity.handle,
        displayName: originalData.identity.displayName,
      };

      const result = await neo4jAdapter.publish({
        viewer,
        cso,
        supersedesId: previousId,
        revisionMetadata: {
          revisionNumber: rev,
          rootAssertionId,
        },
      });

      previousId = result.assertionId;
    }
  }

  console.log(`✅ Created ${NUM_REVISION_CHAINS} revision chains`);
}

async function cleanupExistingTestData() {
  console.log("🧹 Cleaning up existing test data...");

  // Clean up Neo4j
  const session = driver.session();
  try {
    await session.run(
      `
      MATCH (a:Assertion)
      WHERE a.id STARTS WITH 'asrt_' AND a.text CONTAINS 'Load test'
      DETACH DELETE a
      `
    );

    await session.run(
      `
      MATCH (u:Identity)
      WHERE u.id STARTS WITH $prefix
      DETACH DELETE u
      `,
      { prefix: USER_PREFIX }
    );
  } finally {
    await session.close();
  }

  // Clean up PostgreSQL
  const client = await pool.connect();
  try {
    await client.query(
      `
      DELETE FROM "user"
      WHERE id LIKE $1
      `,
      [`${USER_PREFIX}%`]
    );
  } finally {
    client.release();
  }

  console.log("✅ Cleanup complete");
}

async function main() {
  console.log("🌊 Water Load Test Data Seeder\n");

  try {
    // Clean up existing test data first (idempotent)
    await cleanupExistingTestData();

    // Create test data
    await createTestUsers();
    const rootIds = await createRootAssertions();
    const responseIds = await createResponses(rootIds);
    const allAssertionIds = [...rootIds, ...responseIds];

    await createReactions(allAssertionIds);
    await createRevisionChains(rootIds);

    console.log("\n✅ Load test data seeded successfully!");
    console.log("\nSummary:");
    console.log(`  - ${NUM_USERS} test users`);
    console.log(`  - ${NUM_ROOT_ASSERTIONS} root assertions`);
    console.log(`  - ${NUM_RESPONSES} responses`);
    console.log(`  - ~${NUM_REACTIONS} reactions`);
    console.log(`  - ${NUM_REVISION_CHAINS} revision chains`);
  } catch (err) {
    console.error("❌ Failed to seed load test data:", err);
    process.exit(1);
  } finally {
    await neo4jAdapter.close();
    await driver.close();
    await pool.end();
  }
}

main();
