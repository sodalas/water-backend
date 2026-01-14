// water-backend/load-tests/scenario-a-feed-read.js
/**
 * Scenario A: Feed Read Storm
 *
 * Objective: Validate feed projection under concurrent read pressure.
 * Profile: 100 concurrent users, each requests home feed every 2 seconds, 5 minutes.
 * Invariants tested: Feed root purity, version resolution, chronological ordering.
 * Metrics: p50/p95/p99 response times, near-miss count, Neo4j query timing.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const feedRootPurityViolations = new Rate('feed_root_purity_violations');
const feedResponseTime = new Trend('feed_response_time');
const chronologicalOrderViolations = new Counter('chronological_order_violations');
const versionResolutionViolations = new Counter('version_resolution_violations');

export const options = {
  scenarios: {
    feed_read_storm: {
      executor: 'constant-vus',
      vus: 100,
      duration: '5m',
    },
  },
  thresholds: {
    'http_req_failed': ['rate<0.01'],  // <1% errors
    'http_req_duration': ['p(95)<2000'], // p95 < 2s
    'feed_root_purity_violations': ['rate==0'], // Zero violations
    'chronological_order_violations': ['count==0'], // Zero violations
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

export default function () {
  // Each VU has a test user (cycle through 100 users)
  const userId = `loadtest-user-${(__VU % 100) + 1}`;

  // Request home feed
  // Note: The backend allows unauthenticated access to the home feed,
  // it just won't filter based on visibility if no user is authenticated.
  // For a more realistic test with auth, you would need to:
  // 1. Create sessions for test users
  // 2. Use session tokens in Authorization header
  const res = http.get(`${BASE_URL}/api/home`, {
    headers: {
      'Content-Type': 'application/json',
    },
    tags: { name: 'HomeFeed' },
  });

  // Track response time
  feedResponseTime.add(res.timings.duration);

  // Validate response structure
  const success = check(res, {
    'status is 200': (r) => r.status === 200,
    'has items array': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.items);
      } catch (e) {
        return false;
      }
    },
  });

  // Invariant checks on response
  if (res.status === 200) {
    let body;
    try {
      body = JSON.parse(res.body);
    } catch (e) {
      console.error('Failed to parse response body:', e);
      return;
    }

    // INVARIANT 1: Feed root purity
    // No responses should appear as root items in the feed.
    // The feed should only contain root assertions (not replies).
    const hasRootPurityViolation = body.items.some(item =>
      item.assertionType === 'response' || item.replyTo != null
    );
    feedRootPurityViolations.add(hasRootPurityViolation);

    if (hasRootPurityViolation) {
      console.error('ROOT PURITY VIOLATION: Response found in home feed');
      console.error('Items with violations:', JSON.stringify(
        body.items.filter(item => item.assertionType === 'response' || item.replyTo != null)
      ));
    }

    // INVARIANT 2: Version resolution
    // No superseded items should appear in the feed.
    // If an assertion has a newer version, only the latest version should be shown.
    const hasVersionViolation = body.items.some(item =>
      item.supersededBy != null || item.isSuperseded === true
    );

    if (hasVersionViolation) {
      versionResolutionViolations.add(1);
      console.error('VERSION RESOLUTION VIOLATION: Superseded item in feed');
      console.error('Items with violations:', JSON.stringify(
        body.items.filter(item => item.supersededBy != null || item.isSuperseded === true)
      ));
    }

    // INVARIANT 3: Chronological ordering
    // NOTE: Chronological ordering is a projection guarantee (newest-first display),
    // NOT a ranking signal. Feed order is deterministic based on createdAt timestamp,
    // not importance-based or algorithmic. This ensures consistent, predictable ordering.
    //
    // Constraint: Items must be ordered by createdAt DESC (newest first).
    // If two items have the same createdAt, they should be ordered by id DESC.
    if (body.items.length > 1) {
      for (let i = 1; i < body.items.length; i++) {
        const prev = body.items[i - 1];
        const curr = body.items[i];

        // Parse timestamps
        const prevTime = new Date(prev.createdAt).getTime();
        const currTime = new Date(curr.createdAt).getTime();

        // Check chronological ordering (prev should be >= curr, because newest first)
        const isOrdered = prevTime > currTime ||
          (prevTime === currTime && prev.assertionId >= curr.assertionId);

        if (!isOrdered) {
          chronologicalOrderViolations.add(1);
          console.error('CHRONOLOGICAL ORDER VIOLATION:');
          console.error(`  Previous: ${prev.assertionId} at ${prev.createdAt}`);
          console.error(`  Current:  ${curr.assertionId} at ${curr.createdAt}`);
        }
      }
    }

    // OBSERVATION: Reaction counts
    // NOTE: We do NOT assert exact accuracy of reaction counts.
    // Per CONTRACTS.md §3.2, reaction aggregation is eventually consistent
    // and not used for ranking. Counts are informational only.
    // We log them for observability but do not fail on discrepancies.
    const totalReactions = body.items.reduce((sum, item) => {
      if (item.reactions && typeof item.reactions === 'object') {
        return sum + Object.values(item.reactions).reduce((a, b) => a + b, 0);
      }
      return sum;
    }, 0);

    if (totalReactions > 0 && __ITER === 0) {
      console.log(`Observed ${totalReactions} total reactions across ${body.items.length} items`);
    }
  }

  // Wait 2 seconds between requests (per scenario spec)
  sleep(2);
}

/**
 * Setup function - runs once before the test starts
 */
export function setup() {
  console.log('Starting Scenario A: Feed Read Storm');
  console.log(`Target: ${BASE_URL}`);
  console.log('Duration: 5 minutes');
  console.log('Virtual Users: 100');
  console.log('Request interval: 2 seconds');
  console.log('');
  console.log('Invariants being tested:');
  console.log('  1. Feed root purity (no responses as roots)');
  console.log('  2. Version resolution (no superseded items)');
  console.log('  3. Chronological ordering (newest-first)');
  console.log('');
}

/**
 * Teardown function - runs once after the test completes
 */
export function teardown(data) {
  console.log('');
  console.log('Scenario A: Feed Read Storm completed');
  console.log('Check the summary above for results.');
}
