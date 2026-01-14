// water-backend/load-tests/scenario-d-thread-depth.js
/**
 * Scenario D: Thread Depth Stress
 *
 * Objective: Validate deep thread traversal under concurrent read pressure.
 * Profile: Thread with 500 responses ~50 levels deep, 20 concurrent users,
 * view every 1 second, 2 minutes.
 * Invariants tested: Thread completeness, reply reachability, version resolution.
 * Metrics: Response count vs expected, thread-empty-responses near-misses, query time.
 *
 * Prerequisites:
 * - Run seed:deep-thread first to create the test thread
 * - Thread ID is loadtest-deep-root (or pass via THREAD_ID env var)
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter, Trend } from 'k6/metrics';

// Custom metrics
const threadComplete = new Rate('thread_complete');
const threadEmpty = new Counter('thread_empty_responses');
const threadLatency = new Trend('thread_latency');
const responseCountMismatch = new Counter('response_count_mismatch');
const versionResolutionErrors = new Counter('version_resolution_errors');
const replyReachabilityErrors = new Counter('reply_reachability_errors');

export const options = {
  scenarios: {
    thread_depth: {
      executor: 'constant-vus',
      vus: 20,
      duration: '2m',
    },
  },
  thresholds: {
    'thread_complete': ['rate>0.95'],  // >95% complete threads
    'thread_empty_responses': ['count==0'], // No empty responses when root exists
    'response_count_mismatch': ['count<5'], // Allow some variation
    'http_req_duration': ['p(95)<5000'], // p95 < 5s (deep traversal can be slow)
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const THREAD_ID = __ENV.THREAD_ID || 'loadtest-deep-root';
const EXPECTED_RESPONSE_COUNT = parseInt(__ENV.EXPECTED_RESPONSES || '500', 10);

export default function () {
  const userId = `loadtest-user-${(__VU % 20) + 1}`;

  const res = http.get(`${BASE_URL}/api/thread/${THREAD_ID}`, {
    headers: {
      'Authorization': `Bearer test-token-${userId}`,
      'Content-Type': 'application/json',
      'X-Test-User-Id': userId,
    },
    tags: { name: 'ThreadView' },
  });

  threadLatency.add(res.timings.duration);

  if (res.status === 200) {
    let body;
    try {
      body = JSON.parse(res.body);
    } catch (e) {
      console.error(`Parse error: ${e.message}`);
      return;
    }

    const responses = body.responses || body.items || [];
    const root = body.root || body.assertion;

    // INVARIANT 1: Thread completeness
    // At least 95% of expected responses should be returned
    const completenessThreshold = EXPECTED_RESPONSE_COUNT * 0.95;
    const isComplete = responses.length >= completenessThreshold;
    threadComplete.add(isComplete);

    // INVARIANT 2: Thread not empty when root exists
    // If root exists but no responses, that's a near-miss
    if (root && root.assertionId && responses.length === 0) {
      threadEmpty.add(1);
      console.error('NEAR-MISS: Thread has root but zero responses');
    }

    // Track response count variations
    if (responses.length < EXPECTED_RESPONSE_COUNT * 0.9) {
      responseCountMismatch.add(1);
      if (__ITER === 0) {
        console.log(`Response count: ${responses.length} (expected ~${EXPECTED_RESPONSE_COUNT})`);
      }
    }

    // INVARIANT 3: Reply reachability
    // All responses should have a valid replyTo or be properly linked
    const invalidReplies = responses.filter(r =>
      !r.replyTo && !r.parentId && r.assertionType === 'response'
    );
    if (invalidReplies.length > 0) {
      replyReachabilityErrors.add(invalidReplies.length);
      if (__ITER === 0) {
        console.error(`INVARIANT VIOLATION: ${invalidReplies.length} responses without replyTo`);
      }
    }

    // INVARIANT 4: Version resolution
    // No superseded versions should appear in thread responses
    const supersededItems = responses.filter(r =>
      r.supersededBy != null || r.isSuperseded === true
    );
    if (supersededItems.length > 0) {
      versionResolutionErrors.add(supersededItems.length);
      if (__ITER === 0) {
        console.error(`INVARIANT VIOLATION: ${supersededItems.length} superseded items in thread`);
      }
    }

    // Structural checks
    check(body, {
      'has root assertion': (b) => (b.root && b.root.assertionId) || (b.assertion && b.assertion.id),
      'has responses array': (b) => Array.isArray(b.responses) || Array.isArray(b.items),
      'responses have structure': (b) => {
        const items = b.responses || b.items || [];
        return items.length === 0 || items.every(r =>
          r.assertionId || r.id
        );
      },
    });

  } else if (res.status === 404) {
    console.error(`Thread not found: ${THREAD_ID}`);
    console.error('Did you run: npm run seed:deep-thread ?');
  }

  check(res, {
    'thread returns 200': (r) => r.status === 200,
  });

  // View every 1 second
  sleep(1);
}

/**
 * Setup function - runs once before the test starts
 */
export function setup() {
  console.log('Starting Scenario D: Thread Depth Stress');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Thread ID: ${THREAD_ID}`);
  console.log('Duration: 2 minutes');
  console.log('Virtual Users: 20');
  console.log('Request interval: 1 second');
  console.log(`Expected responses: ~${EXPECTED_RESPONSE_COUNT}`);
  console.log('');
  console.log('Invariants being tested:');
  console.log('  1. Thread completeness (>95% of expected responses returned)');
  console.log('  2. Thread not empty (root exists → responses exist)');
  console.log('  3. Reply reachability (all responses have valid parent link)');
  console.log('  4. Version resolution (no superseded items in results)');
  console.log('');
  console.log('NOTE: Run seed:deep-thread first to create test data.');
  console.log('');
}

/**
 * Teardown function - runs once after the test completes
 */
export function teardown(data) {
  console.log('');
  console.log('Scenario D: Thread Depth Stress completed');
  console.log('Check the summary above for results.');
}

/**
 * Handle summary - customize output
 */
export function handleSummary(data) {
  console.log('\n=== Thread Depth Stress Summary ===');
  console.log(`Total thread views: ${data.metrics.http_reqs?.values?.count || 0}`);
  console.log(`Completeness rate: ${((data.metrics.thread_complete?.values?.rate || 0) * 100).toFixed(2)}%`);
  console.log(`Empty thread events: ${data.metrics.thread_empty_responses?.values?.count || 0}`);
  console.log(`Response count mismatches: ${data.metrics.response_count_mismatch?.values?.count || 0}`);
  console.log(`Reply reachability errors: ${data.metrics.reply_reachability_errors?.values?.count || 0}`);
  console.log(`Version resolution errors: ${data.metrics.version_resolution_errors?.values?.count || 0}`);
  console.log(`p95 latency: ${data.metrics.thread_latency?.values?.['p(95)']?.toFixed(2) || 'N/A'}ms`);

  return {
    'stdout': JSON.stringify(data, null, 2),
  };
}
