import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTransitions, getOffsetMinutes } from '../src/core.js';

// All tests use zones with well-known, stable rules so the results are
// deterministic regardless of the host's tzdata version. We do not assert on
// wall-clock time; every expected value is a fixed UTC instant.

test('America/New_York 2024 has two transitions', () => {
  const trs = findTransitions('America/New_York', 2024);
  assert.equal(trs.length, 2);

  const spring = trs[0];
  assert.equal(spring.direction, 'forward');
  assert.equal(spring.fromOffsetMinutes, -300);
  assert.equal(spring.toOffsetMinutes, -240);
  // 2024-03-10 07:00:00 UTC is 02:00 EST -> 03:00 EDT.
  assert.equal(spring.at.toISOString(), '2024-03-10T07:00:00.000Z');

  const fall = trs[1];
  assert.equal(fall.direction, 'backward');
  assert.equal(fall.fromOffsetMinutes, -240);
  assert.equal(fall.toOffsetMinutes, -300);
  // 2024-11-03 06:00:00 UTC is 02:00 EDT -> 01:00 EST.
  assert.equal(fall.at.toISOString(), '2024-11-03T06:00:00.000Z');
});

test('Europe/London 2024 has two transitions', () => {
  const trs = findTransitions('Europe/London', 2024);
  assert.equal(trs.length, 2);

  const spring = trs[0];
  assert.equal(spring.direction, 'forward');
  assert.equal(spring.fromOffsetMinutes, 0);
  assert.equal(spring.toOffsetMinutes, 60);
  assert.equal(spring.at.toISOString(), '2024-03-31T01:00:00.000Z');

  const fall = trs[1];
  assert.equal(fall.direction, 'backward');
  assert.equal(fall.fromOffsetMinutes, 60);
  assert.equal(fall.toOffsetMinutes, 0);
  assert.equal(fall.at.toISOString(), '2024-10-27T01:00:00.000Z');
});

test('Australia/Sydney 2024 has two transitions', () => {
  const trs = findTransitions('Australia/Sydney', 2024);
  assert.equal(trs.length, 2);

  // Sydney ends DST in April (southern hemisphere).
  const end = trs[0];
  assert.equal(end.direction, 'backward');
  assert.equal(end.fromOffsetMinutes, 660);
  assert.equal(end.toOffsetMinutes, 600);
  assert.equal(end.at.toISOString(), '2024-04-06T16:00:00.000Z');

  // Sydney starts DST in October (southern hemisphere).
  const start = trs[1];
  assert.equal(start.direction, 'forward');
  assert.equal(start.fromOffsetMinutes, 600);
  assert.equal(start.toOffsetMinutes, 660);
  assert.equal(start.at.toISOString(), '2024-10-05T16:00:00.000Z');
});

test('Asia/Kolkata has no transitions in 2024', () => {
  const trs = findTransitions('Asia/Kolkata', 2024);
  assert.deepEqual(trs, []);
  assert.equal(getOffsetMinutes('Asia/Kolkata', new Date('2024-06-01T00:00:00Z')), 330);
});

test('Africa/Nairobi has no transitions in 2024', () => {
  const trs = findTransitions('Africa/Nairobi', 2024);
  assert.deepEqual(trs, []);
  assert.equal(getOffsetMinutes('Africa/Nairobi', new Date('2024-06-01T00:00:00Z')), 180);
});

test('a zone with a fractional-hour offset reports the right offset', () => {
  // Asia/Kathmandu is UTC+5:45 all year.
  assert.equal(getOffsetMinutes('Asia/Kathmandu', new Date('2024-01-01T00:00:00Z')), 345);
  assert.equal(getOffsetMinutes('Asia/Kathmandu', new Date('2024-07-01T00:00:00Z')), 345);
});

test('invalid timezone throws', () => {
  assert.throws(() => findTransitions('Not/AZone', 2024), /Invalid time zone|RangeError/);
});

test('non-integer year throws', () => {
  assert.throws(() => findTransitions('UTC', 2024.5), TypeError);
});

test('empty timezone throws', () => {
  assert.throws(() => findTransitions('', 2024), TypeError);
});

test('invalid probeIntervalMs throws', () => {
  assert.throws(() => findTransitions('UTC', 2024, { probeIntervalMs: 0 }), RangeError);
  assert.throws(() => findTransitions('UTC', 2024, { probeIntervalMs: 7 }), RangeError);
  assert.throws(() => findTransitions('UTC', 2024, { probeIntervalMs: 2 * 3600 * 1000 }), RangeError);
});

test('probeIntervalMs of 30 minutes finds the same transitions as the default', () => {
  const coarse = findTransitions('America/New_York', 2024);
  const fine = findTransitions('America/New_York', 2024, { probeIntervalMs: 30 * 60 * 1000 });
  assert.equal(fine.length, coarse.length);
  for (let i = 0; i < coarse.length; i++) {
    assert.equal(fine[i].at.getTime(), coarse[i].at.getTime());
    assert.equal(fine[i].direction, coarse[i].direction);
  }
});

test('UTC has no transitions', () => {
  assert.deepEqual(findTransitions('UTC', 2024), []);
});

test('getOffsetMinutes rejects an invalid Date', () => {
  assert.throws(() => getOffsetMinutes('UTC', new Date('nope')), TypeError);
});
