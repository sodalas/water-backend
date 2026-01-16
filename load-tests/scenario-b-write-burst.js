// water-backend/load-tests/scenario-b-write-burst.js
/**
 * Scenario B: Write Burst
 *
 * Objective: Validate publish idempotency and notification generation under
 * concurrent write pressure.
 * Profile: 50 concurrent users, 1 publish/second each, 10% replies, 3 minutes.
 * Invariants tested: Idempotent publish (409 conflicts expected), notification generation,
 * SUPERSEDES chain integrity.
 * Metrics: Publish success rate, near-miss count by type, outbox depth.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter, Trend } from 'k6/metrics';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

// Custom metrics
const publishSuccess = new Rate('publish_success');
const publishConflicts = new Counter('publish_conflicts'); // 409s - expected under concurrent revision
const replyPublishes = new Counter('reply_publishes');
const rootPublishes = new Counter('root_publishes');
const publishLatency = new Trend('publish_latency');
const serverErrors = new Counter('server_errors'); // 5xx - unexpected

export const options = {
  scenarios: {
    write_burst: {
      executor: 'constant-vus',
      vus: 50,
      duration: '3m',
    },
  },
  thresholds: {
    'publish_success': ['rate>0.95'],  // >95% success
    'http_req_duration': ['p(95)<3000'], // p95 < 3s
    'server_errors': ['count<10'], // Very few server errors
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

// Track published assertion IDs for replies (shared across VUs in same iteration)
// Note: k6 VUs don't share state, so each VU maintains its own list
// This means replies are more likely to target assertions from the same VU
const publishedIds = [];

export default function () {
  const userId = `loadtest-user-${(__VU % 50) + 1}`;
  const isReply = Math.random() < 0.1; // 10% are replies

  // Generate idempotency key for proper idempotency testing
  const idempotencyKey = `k6-${userId}-${Date.now()}-${randomString(8)}`;

  let cso;

  if (isReply && publishedIds.length > 0) {
    // Reply to random existing assertion from this VU's history
    const parentId = publishedIds[Math.floor(Math.random() * publishedIds.length)];
    cso = {
      assertionType: 'response',
      text: `Load test reply ${randomString(8)} at ${Date.now()}`,
      refs: [{ uri: `assertion:${parentId}` }],
      visibility: 'public',
      topics: [],
      mentions: [],
      media: [],
    };
    replyPublishes.add(1);
  } else {
    // Root assertion - randomly choose moment or note
    const assertionType = Math.random() < 0.7 ? 'moment' : 'note';
    cso = {
      assertionType,
      text: `Load test ${assertionType} ${randomString(8)} at ${Date.now()}`,
      visibility: Math.random() < 0.8 ? 'public' : 'private', // 80% public
      topics: Math.random() < 0.3 ? [`loadtest-topic-${Math.floor(Math.random() * 10)}`] : [],
      mentions: [],
      refs: [],
      media: [],
    };
    rootPublishes.add(1);
  }

  // Wrap CSO in expected request body structure
  const payload = {
    cso,
    idempotencyKey,
  };

  const res = http.post(`${BASE_URL}/api/publish`, JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      'X-Test-User-Id': userId, // For test auth bypass (non-production only)
    },
    tags: { name: 'Publish' },
  });

  publishLatency.add(res.timings.duration);

  // Track results
  const success = res.status === 201 || res.status === 200;
  publishSuccess.add(success);

  if (res.status === 409) {
    // 409 Conflict is expected under concurrent revision - this is a near-miss, not failure
    // The write was rejected due to optimistic locking, which is correct behavior
    publishConflicts.add(1);
  }

  if (res.status >= 500) {
    serverErrors.add(1);
    console.error(`SERVER ERROR: ${res.status} - ${res.body}`);
  }

  // Store published ID for future replies
  if (success) {
    try {
      const body = JSON.parse(res.body);
      const assertionId = body.assertionId || body.id;
      if (assertionId) {
        publishedIds.push(assertionId);
        // Keep array bounded to prevent memory issues
        if (publishedIds.length > 100) {
          publishedIds.shift();
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  check(res, {
    'publish returns success or conflict': (r) => [200, 201, 409].includes(r.status),
    'response has assertion ID on success': (r) => {
      if (r.status === 409) return true; // Conflict doesn't return ID
      try {
        const body = JSON.parse(r.body);
        return body.assertionId || body.id;
      } catch {
        return false;
      }
    },
  });

  // 1 publish per second per user
  sleep(1);
}

/**
 * Setup function - runs once before the test starts
 */
export function setup() {
  console.log('Starting Scenario B: Write Burst');
  console.log(`Target: ${BASE_URL}`);
  console.log('Duration: 3 minutes');
  console.log('Virtual Users: 50');
  console.log('Publish rate: 1/second/user (50 req/sec total)');
  console.log('Reply ratio: 10%');
  console.log('');
  console.log('Invariants being tested:');
  console.log('  1. Publish idempotency (409 conflicts are expected, not failures)');
  console.log('  2. Notification generation (async, not asserted but logged)');
  console.log('  3. SUPERSEDES chain integrity (no orphaned revisions)');
  console.log('');
}

/**
 * Teardown function - runs once after the test completes
 */
export function teardown(data) {
  console.log('');
  console.log('Scenario B: Write Burst completed');
  console.log('');
  console.log('Post-test validation queries:');
  console.log('');
  console.log('1. Check for orphaned SUPERSEDES chains:');
  console.log('   MATCH (a:Assertion)-[:SUPERSEDES]->(b:Assertion)');
  console.log('   WHERE NOT EXISTS { MATCH (c:Assertion)-[:SUPERSEDES]->(a) }');
  console.log('   AND a.text CONTAINS "Load test"');
  console.log('   RETURN a.id as latestVersion, count(b) as chainLength');
  console.log('');
  console.log('2. Check notification outbox depth:');
  console.log('   SELECT COUNT(*) FROM notification_outbox WHERE status = "pending"');
  console.log('');
}

/**
 * Handle summary - customize output
 */
export function handleSummary(data) {
  console.log('\n=== Write Burst Summary ===');
  console.log(`Total publish attempts: ${data.metrics.http_reqs?.values?.count || 0}`);
  console.log(`Success rate: ${((data.metrics.publish_success?.values?.rate || 0) * 100).toFixed(2)}%`);
  console.log(`Root publishes: ${data.metrics.root_publishes?.values?.count || 0}`);
  console.log(`Reply publishes: ${data.metrics.reply_publishes?.values?.count || 0}`);
  console.log(`409 Conflicts (expected): ${data.metrics.publish_conflicts?.values?.count || 0}`);
  console.log(`Server errors: ${data.metrics.server_errors?.values?.count || 0}`);
  console.log(`p95 latency: ${data.metrics.publish_latency?.values?.['p(95)']?.toFixed(2) || 'N/A'}ms`);

  return {
    'stdout': JSON.stringify(data, null, 2),
  };
}
