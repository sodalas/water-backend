/**
 * setup_neo4j_reactions.js
 *
 * Phase E.1: Sets up Neo4j constraints and indexes for reactions.
 *
 * Run once to create:
 * - Property existence constraints on REACTED_TO edges
 * - Performance index on reaction type
 *
 * Usage: node src/scripts/setup_neo4j_reactions.js
 */

import neo4j from "neo4j-driver";
import "dotenv/config";

const constraints = [
  // Ensure type is always present on REACTED_TO edges
  `CREATE CONSTRAINT reacted_to_type_exists IF NOT EXISTS
   FOR ()-[r:REACTED_TO]-()
   REQUIRE r.type IS NOT NULL`,

  // Ensure createdAt is always present on REACTED_TO edges
  `CREATE CONSTRAINT reacted_to_createdAt_exists IF NOT EXISTS
   FOR ()-[r:REACTED_TO]-()
   REQUIRE r.createdAt IS NOT NULL`,
];

const indexes = [
  // Performance index for filtering by reaction type
  `CREATE INDEX reacted_to_type_index IF NOT EXISTS
   FOR ()-[r:REACTED_TO]-()
   ON (r.type)`,
];

async function setupReactionConstraints() {
  const uri = process.env.NEO4J_URI;
  const user = process.env.NEO4J_USER;
  const password = process.env.NEO4J_PASSWORD;

  if (!uri || !user || !password) {
    console.error("❌ Missing NEO4J_URI, NEO4J_USER, or NEO4J_PASSWORD environment variables");
    process.exit(1);
  }

  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  const session = driver.session();

  try {
    console.log("🔧 Setting up Neo4j reaction constraints...\n");

    // Create constraints
    for (const constraint of constraints) {
      console.log("Creating constraint:", constraint.split("\n")[0].trim());
      try {
        await session.run(constraint);
        console.log("  ✅ Created\n");
      } catch (err) {
        if (err.message.includes("already exists")) {
          console.log("  ℹ️  Already exists\n");
        } else {
          throw err;
        }
      }
    }

    // Create indexes
    for (const index of indexes) {
      console.log("Creating index:", index.split("\n")[0].trim());
      try {
        await session.run(index);
        console.log("  ✅ Created\n");
      } catch (err) {
        if (err.message.includes("already exists")) {
          console.log("  ℹ️  Already exists\n");
        } else {
          throw err;
        }
      }
    }

    console.log("✅ Neo4j reaction constraints setup complete.");
  } catch (err) {
    console.error("❌ Failed to setup Neo4j reaction constraints:", err);
    process.exit(1);
  } finally {
    await session.close();
    await driver.close();
  }
}

setupReactionConstraints();
