// DST Transition Finder
//
// The core problem: given an IANA timezone identifier and a calendar year,
// return the exact UTC instants at which daylight saving time begins and ends,
// together with the direction of each transition.
//
// Design decisions:
//
// 1. We do not parse the IANA database. Instead we probe the host's built-in
//    Intl.DateTimeFormat with a fixed reference date and compare the reported
//    offset against the offset at the start of the year. This is the only
//    dependency-free way to get correct answers for every zone the host knows
//    about, including zones with fractional-hour offsets and zones with
//    historical rule changes.
//
// 2. A transition is defined as a change in the timezone's UTC offset. We scan
//    the year at a coarse granularity (one probe per hour by default) and then
//    binary-search the interval between the last matching probe and the first
//    non-matching probe. This keeps the number of Intl calls bounded and makes
//    the result exact to the second for every real-world transition, because
//    all IANA transitions occur on whole-second boundaries.
//
// 3. We return UTC Date objects. The caller can format them in the target zone
//    if desired. Returning local-time strings would be ambiguous exactly at the
//    transition instant, which is the one instant the caller cares about.
//
// 4. The direction is 'forward' when the offset increases (clocks move forward,
//    DST starts) and 'backward' when the offset decreases (clocks move back,
//    DST ends). This matches the common English usage and is what callers
//    almost always want to branch on.

const MS_PER_HOUR = 3600 * 1000;
const MS_PER_SECOND = 1000;

// Cached formatter per zone. Intl.DateTimeFormat construction is relatively
// expensive and we may construct many probes per call.
const formatterCache = new Map();

function getFormatter(timeZone) {
  let fmt = formatterCache.get(timeZone);
  if (fmt === undefined) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      era: 'short',
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

// Returns the offset in minutes east of UTC for the given instant in the given
// zone. The sign convention matches the IANA convention: UTC+2 is +120.
//
// We derive the offset by formatting the instant in the target zone and then
// comparing the wall-clock fields against the same instant read in UTC. This
// avoids relying on the (non-standard, though widely implemented)
// `timeZoneName: 'longOffset'` option.
function getOffsetMinutes(timeZone, date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('date must be a valid Date');
  }
  const fmt = getFormatter(timeZone);
  const parts = fmt.formatToParts(date);
  const fields = {};
  for (const p of parts) {
    if (p.type !== 'literal') {
      fields[p.type] = p.value;
    }
  }
  // Some engines emit year as e.g. "2024" and era as "AD"; others may include
  // a leading era marker. We only need the numeric year for the offset math,
  // so we parse it directly.
  const year = parseInt(fields.year, 10);
  const month = parseInt(fields.month, 10);
  const day = parseInt(fields.day, 10);
  const hour = parseInt(fields.hour, 10);
  const minute = parseInt(fields.minute, 10);
  const second = parseInt(fields.second, 10);

  // Build a UTC timestamp from the wall-clock fields. This timestamp is the
  // instant that would be represented by those fields if the zone were UTC.
  const asUTC = Date.UTC(year, month - 1, day, hour, minute, second);
  // The offset is the difference between the real instant and the wall-clock
  // interpretation. Round to the nearest minute because some zones have
  // sub-minute historical offsets that we do not need to expose here.
  const diffMs = asUTC - date.getTime();
  return Math.round(diffMs / (60 * 1000));
}

function getTimeZoneOffset(timeZone, date) {
  return getOffsetMinutes(timeZone, date);
}

// Binary search for the smallest instant in [lo, hi] at which the offset
// differs from the offset at `lo`. Returns null if the offset is constant
// across the whole interval. The interval is assumed to be small enough that
// at most one transition occurs within it (which is true for our hourly
// probe granularity: no IANA zone transitions twice within an hour).
function findTransitionInInterval(timeZone, lo, hi, offsetAtLo) {
  // If the offset is the same at both ends, there is no transition here.
  if (getOffsetMinutes(timeZone, new Date(hi)) === offsetAtLo) {
    return null;
  }
  // Invariant: offset(lo) === offsetAtLo, offset(hi) !== offsetAtLo.
  // We narrow until hi - lo <= 1 second, which is finer than any real
  // transition boundary.
  while (hi - lo > MS_PER_SECOND) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (getOffsetMinutes(timeZone, new Date(mid)) === offsetAtLo) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  // `hi` is the first instant at which the offset changed. Round up to the
  // next whole second to be exact for whole-second transitions.
  const transitionMs = Math.ceil(hi / MS_PER_SECOND) * MS_PER_SECOND;
  const before = getOffsetMinutes(timeZone, new Date(transitionMs - MS_PER_SECOND));
  const after = getOffsetMinutes(timeZone, new Date(transitionMs));
  return {
    at: new Date(transitionMs),
    fromOffsetMinutes: before,
    toOffsetMinutes: after,
    direction: after > before ? 'forward' : 'backward',
  };
}

// Returns an array of transition objects for the given IANA timezone and year.
// Each object has:
//   at                  - Date (UTC instant of the transition)
//   fromOffsetMinutes   - offset in minutes before the transition
//   toOffsetMinutes     - offset in minutes after the transition
//   direction           - 'forward' or 'backward'
//
// The year is interpreted as the calendar year in the target timezone. We
// probe from Jan 1 00:00 local time to Jan 1 00:00 local time of the next
// year. Because the offset can change at the boundary, we compute the local
// start by taking the UTC instant of Jan 1 00:00 UTC and adjusting by the
// offset at that instant; this is stable enough for a one-hour probe grid.
//
// A `probeIntervalMs` option is accepted for testing; it must divide an hour
// evenly and be at most one hour. The default is one hour.
function findTransitions(timeZone, year, options = {}) {
  if (typeof timeZone !== 'string' || timeZone.length === 0) {
    throw new TypeError('timeZone must be a non-empty string');
  }
  if (!Number.isInteger(year)) {
    throw new TypeError('year must be an integer');
  }
  const probeIntervalMs = options.probeIntervalMs ?? MS_PER_HOUR;
  if (!Number.isInteger(probeIntervalMs) || probeIntervalMs <= 0 || probeIntervalMs > MS_PER_HOUR) {
    throw new RangeError('probeIntervalMs must be a positive integer no greater than 3600000');
  }
  if (MS_PER_HOUR % probeIntervalMs !== 0) {
    throw new RangeError('probeIntervalMs must divide 3600000 evenly');
  }

  // Start of the year in the target zone. We approximate by taking Jan 1
  // 00:00 UTC and shifting by the offset at that instant. The offset at the
  // very start of the year is constant for every real zone (no transition
  // occurs exactly at midnight UTC on Jan 1 in the modern era), so this is
  // exact for our purposes.
  const jan1Utc = Date.UTC(year, 0, 1, 0, 0, 0);
  const startOffset = getOffsetMinutes(timeZone, new Date(jan1Utc));
  const startMs = jan1Utc - startOffset * 60 * 1000;

  const nextJan1Utc = Date.UTC(year + 1, 0, 1, 0, 0, 0);
  const endOffset = getOffsetMinutes(timeZone, new Date(nextJan1Utc));
  const endMs = nextJan1Utc - endOffset * 60 * 1000;

  const transitions = [];
  let prevMs = startMs;
  let prevOffset = getOffsetMinutes(timeZone, new Date(prevMs));

  for (let t = startMs + probeIntervalMs; t <= endMs; t += probeIntervalMs) {
    const offset = getOffsetMinutes(timeZone, new Date(t));
    if (offset !== prevOffset) {
      const tr = findTransitionInInterval(timeZone, prevMs, t, prevOffset);
      if (tr !== null) {
        // Deduplicate: a transition found by an earlier interval should not
        // be reported twice if the probe grid lands exactly on it.
        const last = transitions[transitions.length - 1];
        if (!last || last.at.getTime() !== tr.at.getTime()) {
          transitions.push(tr);
        }
      }
    }
    prevMs = t;
    prevOffset = offset;
  }

  return transitions;
}

export { findTransitions, getTimeZoneOffset, getOffsetMinutes };
