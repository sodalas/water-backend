// water-backend/load-tests/scenario-e-mixed-workload.js
/**
 * Scenario E: Mixed Workload
 *
 * Objective: Simulate realistic usage pattern with multiple operation types.
 * Profile: 200 users (80% readers, 15% publishers, 5% reactors), 10 minutes.
 * Invariants tested: All invariants from previous scenarios under realistic mix.
 * Metrics: All near-miss events, error rate by endpoint, resource utilization.
 *
 * This is the most realistic test - validates system behavior under production-like load.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Counter, Trend } from 'k6/metrics';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

// Metrics by operation type
const feedSuccess = new Rate('feed_success');
const publishSuccess = new Rate('publish_success');
const reactionSuccess = new Rate('reaction_success');
const threadSuccess = new Rate('thread_success');

// Latency by operation
const feedLatency = new Trend('feed_latency');
const publishLatency = new Trend('publish_latency');
const reactionLatency = new Trend('reaction_latency');
const threadLatency = new Trend('thread_latency');

// Invariant violation counters
const feedRootPurityViolations = new Counter('feed_root_purity_violations');
const versionResolutionViolations = new Counter('version_resolution_violations');
const reactionIdempotencyViolations = new Counter('reaction_idempotency_violations');
const serverErrors = new Counter('server_errors');

export const options = {
  scenarios: {
    readers: {
      executor: 'constant-vus',
      vus: 160, // 80% of 200
      duration: '10m',
      exec: 'reader',
    },
    publishers: {
      executor: 'constant-vus',
      vus: 30, // 15% of 200
      duration: '10m',
      exec: 'publisher',
    },
    reactors: {
      executor: 'constant-vus',
      vus: 10, // 5% of 200
      duration: '10m',
      exec: 'reactor',
    },
  },
  thresholds: {
    'feed_success': ['rate>0.99'],
    'publish_success': ['rate>0.95'],
    'reaction_success': ['rate>0.90'],
    'http_req_duration': ['p(95)<3000'],
    'feed_root_purity_violations': ['count==0'],
    'version_resolution_violations': ['count==0'],
    'reaction_idempotency_violations': ['count==0'],
    'server_errors': ['count<10'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

// Shared state for reactors to target published assertions
// Note: k6 VUs don't share state perfectly, so reactors may miss some publishes
const publishedIds = [];

/**
 * Reader behavior: Fetch home feed and occasionally view threads
 * 80% of users - represents casual browsing
 */
export function reader() {
  const userId = `loadtest-reader-${(__VU % 160) + 1}`;

  // 90% home feed, 10% thread view
  const viewThread = Math.random() < 0.1 && publishedIds.length > 0;

  if (viewThread) {
    const threadId = publishedIds[Math.floor(Math.random() * publishedIds.length)];
    const res = http.get(`${BASE_URL}/api/thread/${threadId}`, {
      headers: {
        'Authorization': `Bearer test-token-${userId}`,
        'X-Test-User-Id': userId,
      },
      tags: { name: 'ThreadView' },
    });

    threadLatency.add(res.timings.duration);
    threadSuccess.add(res.status === 200);

    if (res.status >= 500) {
      serverErrors.add(1);
    }
  } else {
    const res = http.get(`${BASE_URL}/api/home`, {
      headers: {
        'Authorization': `Bearer test-token-${userId}`,
        'X-Test-User-Id': userId,
      },
      tags: { name: 'HomeFeed' },
    });

    feedLatency.add(res.timings.duration);
    feedSuccess.add(res.status === 200);

    // Check feed invariants
    if (res.status === 200) {
      try {
        const body = JSON.parse(res.body);
        const items = body.items || [];

        // Feed root purity check
        const hasRootPurityViolation = items.some(item =>
          item.assertionType === 'response' || item.replyTo != null
        );
        if (hasRootPurityViolation) {
          feedRootPurityViolations.add(1);
        }

        // Version resolution check
        const hasVersionViolation = items.some(item =>
          item.supersededBy != null || item.isSuperseded === true
        );
        if (hasVersionViolation) {
          versionResolutionViolations.add(1);
        }
      } catch (e) {
        // Ignore parse errors
      }
    }

    if (res.status >= 500) {
      serverErrors.add(1);
    }
  }

  check({}, { 'reader iteration complete': () => true });

  // Readers browse every 5 seconds
  sleep(5);
}

/**
 * Publisher behavior: Create new posts, occasionally replies
 * 15% of users - represents active content creators
 */
export function publisher() {
  const userId = `loadtest-publisher-${(__VU % 30) + 1}`;

  // 20% replies, 80% new posts
  const isReply = Math.random() < 0.2 && publishedIds.length > 0;

  let payload;
  if (isReply) {
    const parentId = publishedIds[Math.floor(Math.random() * publishedIds.length)];
    payload = {
      assertionType: 'response',
      text: `Mixed workload reply ${randomString(8)} at ${Date.now()}`,
      refs: [{ uri: `water://assertion/${parentId}` }],
      visibility: 'public',
      topics: [],
      mentions: [],
      media: [],
    };
  } else {
    const assertionType = Math.random() < 0.7 ? 'moment' : 'note';
    payload = {
      assertionType,
      text: `Mixed workload ${assertionType} ${randomString(8)} at ${Date.now()}`,
      visibility: Math.random() < 0.9 ? 'public' : 'private',
      topics: Math.random() < 0.3 ? [`topic-${Math.floor(Math.random() * 20)}`] : [],
      mentions: [],
      refs: [],
      media: [],
    };
  }

  const res = http.post(
    `${BASE_URL}/api/publish`,
    JSON.stringify(payload),
    {
      headers: {
        'Authorization': `Bearer test-token-${userId}`,
        'Content-Type': 'application/json',
        'X-Test-User-Id': userId,
      },
      tags: { name: 'Publish' },
    }
  );

  publishLatency.add(res.timings.duration);
  publishSuccess.add([200, 201].includes(res.status));

  // Track published IDs for reactors
  if (res.status === 201) {
    try {
      const body = JSON.parse(res.body);
      const assertionId = body.assertionId || body.id;
      if (assertionId) {
        publishedIds.push(assertionId);
        // Keep bounded
        if (publishedIds.length > 500) {
          publishedIds.shift();
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  if (res.status >= 500) {
    serverErrors.add(1);
  }

  check(res, {
    'publish succeeds or conflicts': (r) => [200, 201, 409].includes(r.status),
  });

  // Publishers create content every 30-60 seconds
  sleep(30 + Math.random() * 30);
}

/**
 * Reactor behavior: Add reactions to existing content
 * 5% of users - represents engagement
 */
export function reactor() {
  const userId = `loadtest-reactor-${(__VU % 10) + 1}`;

  // Wait for content to exist
  if (publishedIds.length === 0) {
    sleep(5);
    return;
  }

  const targetId = publishedIds[Math.floor(Math.random() * publishedIds.length)];
  const reactionTypes = ['like', 'love', 'insightful'];
  const reactionType = reactionTypes[Math.floor(Math.random() * reactionTypes.length)];

  const res = http.post(
    `${BASE_URL}/api/reactions`,
    JSON.stringify({
      assertionId: targetId,
      type: reactionType,
    }),
    {
      headers: {
        'Authorization': `Bearer test-token-${userId}`,
        'Content-Type': 'application/json',
        'X-Test-User-Id': userId,
      },
      tags: { name: 'AddReaction' },
    }
  );

  reactionLatency.add(res.timings.duration);
  reactionSuccess.add([200, 201].includes(res.status));

  // Check for idempotency violations (5xx errors on duplicate reactions)
  if (res.status >= 500) {
    serverErrors.add(1);
    try {
      const body = JSON.parse(res.body);
      if (body.message?.toLowerCase().includes('duplicate') ||
          body.message?.toLowerCase().includes('constraint')) {
        reactionIdempotencyViolations.add(1);
      }
    } catch (e) {
      // Non-JSON error
    }
  }

  check(res, {
    'reaction succeeds': (r) => [200, 201].includes(r.status),
  });

  // Reactors engage every 6-12 seconds
  sleep(6 + Math.random() * 6);
}

/**
 * Setup function
 */
export function setup() {
  console.log('Starting Scenario E: Mixed Workload');
  console.log(`Target: ${BASE_URL}`);
  console.log('Duration: 10 minutes');
  console.log('');
  console.log('User distribution:');
  console.log('  - Readers: 160 VUs (80%) - home feed every 5s');
  console.log('  - Publishers: 30 VUs (15%) - publish every 30-60s');
  console.log('  - Reactors: 10 VUs (5%) - react every 6-12s');
  console.log('');
  console.log('Invariants being validated:');
  console.log('  - Feed root purity (no responses in home feed)');
  console.log('  - Version resolution (no superseded items)');
  console.log('  - Reaction idempotency (no duplicate edge errors)');
  console.log('  - Overall system stability (low error rate)');
  console.log('');
}

/**
 * Teardown function
 */
export function teardown(data) {
  console.log('');
  console.log('Scenario E: Mixed Workload completed');
  console.log('');
  console.log('Post-test validation:');
  console.log('1. Check Sentry for near-miss events');
  console.log('2. Run: npm run validate:graph');
  console.log('');
}

/**
 * Handle summary
 */
export function handleSummary(data) {
  console.log('\n=== Mixed Workload Summary ===');
  console.log(`Total requests: ${data.metrics.http_reqs?.values?.count || 0}`);
  console.log('');
  console.log('By operation type:');
  console.log(`  Feed reads: ${((data.metrics.feed_success?.values?.rate || 0) * 100).toFixed(2)}% success`);
  console.log(`  Publishes: ${((data.metrics.publish_success?.values?.rate || 0) * 100).toFixed(2)}% success`);
  console.log(`  Reactions: ${((data.metrics.reaction_success?.values?.rate || 0) * 100).toFixed(2)}% success`);
  console.log('');
  console.log('Invariant violations:');
  console.log(`  Feed root purity: ${data.metrics.feed_root_purity_violations?.values?.count || 0}`);
  console.log(`  Version resolution: ${data.metrics.version_resolution_violations?.values?.count || 0}`);
  console.log(`  Reaction idempotency: ${data.metrics.reaction_idempotency_violations?.values?.count || 0}`);
  console.log(`  Server errors: ${data.metrics.server_errors?.values?.count || 0}`);
  console.log('');
  console.log(`Overall p95 latency: ${data.metrics.http_req_duration?.values?.['p(95)']?.toFixed(2) || 'N/A'}ms`);

  return {
    'stdout': JSON.stringify(data, null, 2),
  };
}
