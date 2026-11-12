# dst-transition-finder-lib

Returns the exact datetimes when daylight saving time starts and ends for a given IANA timezone and year, including the direction of the transition.

```js
import { findTransitions } from 'dst-transition-finder-lib';

for (const tr of findTransitions('America/New_York', 2024)) {
  console.log(tr.at.toISOString(), tr.direction, tr.fromOffsetMinutes, '->', tr.toOffsetMinutes);
}
// 2024-03-10T07:00:00.000Z forward -300 -> -240
// 2024-11-03T06:00:00.000Z backward -240 -> -300
```

## Why this exists

The IANA timezone database changes several times a year. A library that ships its own copy of the rules needs a release cadence tied to that database, and a library that parses the database at runtime needs a parser and a data file. Both are more than most callers want.

This library takes a third path: it asks the host runtime. Every JavaScript engine that ships `Intl` already has a current copy of the timezone rules, maintained by the platform. We probe the zone across the year and binary-search the exact instant of each offset change. The trade-off is a small number of `Intl.DateTimeFormat` calls per query (about 9000 for a full year at the default one-hour probe interval) instead of a table lookup. In practice this is fast enough for interactive use and completely correct for every zone the host knows about, including zones with fractional-hour offsets and zones whose rules changed mid-year.

## API

### `findTransitions(timeZone, year, options?)`

Returns an array of transition objects for the given IANA timezone identifier and calendar year. The array is ordered chronologically. Each object has:

- `at` — a `Date` holding the UTC instant of the transition.
- `fromOffsetMinutes` — the UTC offset in minutes before the transition.
- `toOffsetMinutes` — the UTC offset in minutes after the transition.
- `direction` — `'forward'` when the offset increases (clocks move forward, DST starts) or `'backward'` when it decreases (clocks move back, DST ends).

`options.probeIntervalMs` overrides the one-hour probe grid. It must be a positive integer that divides 3600000 evenly. The option exists mainly so tests can confirm that a finer grid produces the same answer.

### `getOffsetMinutes(timeZone, date)`

Returns the UTC offset in minutes east of UTC for the given zone at the given instant. The sign convention is the IANA one: `UTC+2` is `120`. This is exported because it is the primitive the transition finder is built on and is occasionally useful on its own.

### `getTimeZoneOffset(timeZone, date)`

An alias for `getOffsetMinutes`, kept for callers who prefer the longer name.

## The awkward edge

A transition is identified by a change in the numeric offset. Zones that change their standard-time offset without changing DST status, or zones that change their abbreviation without changing the offset, will not produce a transition here. That is deliberate: the numeric offset is what affects the wall clock, and it is the only thing every host reports consistently. If you need to detect abbreviation changes, this library is not the right tool.

Zone rules are taken from the host runtime. A host with an outdated tzdata will report outdated transitions. This is the same contract as `Intl.DateTimeFormat` itself.
