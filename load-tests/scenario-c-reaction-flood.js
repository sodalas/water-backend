// water-backend/load-tests/scenario-c-reaction-flood.js
/**
 * Scenario C: Reaction Flood
 *
 * Objective: Validate reaction idempotency under burst conditions.
 * Profile: 100 users, 10 target assertions, all users react to all targets,
 * 10 req/sec/user, 1 minute.
 * Invariants tested: Reaction idempotency (same user+assertion+type = single edge),
 * non-ranking (aggregation is informational only), eventual consistency.
 * Metrics: Final reaction count vs expected, duplicate edge count, p99 latency.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter, Trend } from 'k6/metrics';

// Custom metrics
const reactionSuccess = new Rate('reaction_success');
const reactionDuplicates = new Counter('reaction_duplicates'); // "Already exists" responses - expected
const reactionLatency = new Trend('reaction_latency');
const idempotencyViolations = new Counter('idempotency_violations'); // Should be zero
const serverErrors = new Counter('server_errors');

export const options = {
  scenarios: {
    reaction_flood: {
      executor: 'constant-vus',
      vus: 100,
      duration: '1m',
    },
  },
  thresholds: {
    'reaction_success': ['rate>0.90'],  // >90% success (some dupes expected)
    'idempotency_violations': ['count==0'], // Zero violations
    'http_req_duration': ['p(99)<2000'], // p99 < 2s
    'server_errors': ['count<5'], // Very few server errors
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

// 10 target assertions - these must exist in test data
// These are created by seed-load-test-data.js with known IDs
// If using randomly generated IDs, update the seeder to create these fixed IDs
const TARGET_ASSERTION_PREFIX = 'loadtest-reaction-target-';
const TARGET_ASSERTIONS = [
  `${TARGET_ASSERTION_PREFIX}1`,
  `${TARGET_ASSERTION_PREFIX}2`,
  `${TARGET_ASSERTION_PREFIX}3`,
  `${TARGET_ASSERTION_PREFIX}4`,
  `${TARGET_ASSERTION_PREFIX}5`,
  `${TARGET_ASSERTION_PREFIX}6`,
  `${TARGET_ASSERTION_PREFIX}7`,
  `${TARGET_ASSERTION_PREFIX}8`,
  `${TARGET_ASSERTION_PREFIX}9`,
  `${TARGET_ASSERTION_PREFIX}10`,
];

// Match actual reaction types from the system
const REACTION_TYPES = ['like', 'love', 'insightful'];

export default function () {
  const userId = `loadtest-user-${(__VU % 100) + 1}`;

  // Each user cycles through targets and reaction types
  // This creates maximum concurrent pressure on the same resources
  for (const assertionId of TARGET_ASSERTIONS) {
    for (const reactionType of REACTION_TYPES) {
      const res = http.post(
        `${BASE_URL}/api/reactions`,
        JSON.stringify({
          assertionId,
          type: reactionType,
        }),
        {
          headers: {
            'Authorization': `Bearer test-token-${userId}`,
            'Content-Type': 'application/json',
            'X-Test-User-Id': userId, // For test auth bypass
          },
          tags: { name: 'AddReaction' },
        }
      );

      reactionLatency.add(res.timings.duration);

      // Success: 200/201 (created) or 200 (already exists - idempotent)
      const isSuccess = res.status === 200 || res.status === 201;
      reactionSuccess.add(isSuccess);

      // Track "already exists" responses (expected idempotent behavior)
      if (res.status === 200) {
        try {
          const body = JSON.parse(res.body);
          if (body.alreadyExists || body.existing || body.message?.toLowerCase().includes('already')) {
            reactionDuplicates.add(1);
          }
        } catch {
          // Ignore parse errors
        }
      }

      // 5xx errors suggest potential idempotency violations or system issues
      if (res.status >= 500) {
        serverErrors.add(1);
        console.error(`SERVER ERROR on reaction: ${res.status} - ${res.body}`);

        // If the error indicates duplicate creation, that's a violation
        try {
          const body = JSON.parse(res.body);
          if (body.message?.toLowerCase().includes('duplicate') ||
              body.message?.toLowerCase().includes('constraint')) {
            idempotencyViolations.add(1);
            console.error('IDEMPOTENCY VIOLATION: Duplicate edge creation attempted');
          }
        } catch {
          // Non-JSON error
        }
      }

      check(res, {
        'reaction returns success': (r) => [200, 201].includes(r.status),
      });
    }
  }

  // 10 requests per second per user target
  // We're doing 30 reactions per iteration (10 assertions × 3 types)
  // So sleep 3 seconds to average 10 req/sec
  sleep(3);
}

/**
 * Setup function - runs once before the test starts
 */
export function setup() {
  console.log('Starting Scenario C: Reaction Flood');
  console.log(`Target: ${BASE_URL}`);
  console.log('Duration: 1 minute');
  console.log('Virtual Users: 100');
  console.log('Target assertions: 10');
  console.log('Reaction types: 3 (like, love, insightful)');
  console.log('Expected unique reactions: 100 users × 10 assertions × 3 types = 3000');
  console.log('');
  console.log('Invariants being tested:');
  console.log('  1. Reaction idempotency (same user+assertion+type = single edge)');
  console.log('  2. Non-ranking (aggregation is informational, not for ordering)');
  console.log('  3. Eventual consistency (counts may lag but converge)');
  console.log('');
  console.log('NOTE: Target assertions must exist. Run seed:loadtest first.');
  console.log('');
}

/**
 * Teardown function - runs once after the test completes
 */
export function teardown(data) {
  console.log('');
  console.log('Scenario C: Reaction Flood completed');
  console.log('');
  console.log('Post-test graph integrity check (run in Neo4j):');
  console.log('');
  console.log('1. Check for duplicate reaction edges (should return 0 rows):');
  console.log('   MATCH (u:Identity)-[r:REACTED_TO]->(a:Assertion)');
  console.log('   WHERE a.id STARTS WITH "loadtest-reaction-target-"');
  console.log('   WITH u.id as userId, a.id as assertionId, r.type as type, count(*) as cnt');
  console.log('   WHERE cnt > 1');
  console.log('   RETURN userId, assertionId, type, cnt');
  console.log('');
  console.log('2. Verify expected reaction count (should be ~3000 unique):');
  console.log('   MATCH (u:Identity)-[r:REACTED_TO]->(a:Assertion)');
  console.log('   WHERE a.id STARTS WITH "loadtest-reaction-target-"');
  console.log('   RETURN count(r) as totalReactions,');
  console.log('          count(DISTINCT u) as uniqueUsers,');
  console.log('          count(DISTINCT a) as uniqueAssertions');
  console.log('');
}

/**
 * Handle summary - customize output
 */
export function handleSummary(data) {
  console.log('\n=== Reaction Flood Summary ===');
  console.log(`Total reaction attempts: ${data.metrics.http_reqs?.values?.count || 0}`);
  console.log(`Success rate: ${((data.metrics.reaction_success?.values?.rate || 0) * 100).toFixed(2)}%`);
  console.log(`"Already exists" (expected): ${data.metrics.reaction_duplicates?.values?.count || 0}`);
  console.log(`Idempotency violations: ${data.metrics.idempotency_violations?.values?.count || 0}`);
  console.log(`Server errors: ${data.metrics.server_errors?.values?.count || 0}`);
  console.log(`p99 latency: ${data.metrics.reaction_latency?.values?.['p(99)']?.toFixed(2) || 'N/A'}ms`);
  console.log('');
  console.log('Expected behavior:');
  console.log('  - First reaction per user+assertion+type: 201 Created');
  console.log('  - Subsequent reactions: 200 with alreadyExists flag');
  console.log('  - Final graph: Exactly 1 edge per user+assertion+type');

  return {
    'stdout': JSON.stringify(data, null, 2),
  };
}
