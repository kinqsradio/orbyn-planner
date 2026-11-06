import { touchesDay, wallMinutes } from "../../lib/wall";
import type { Occurrence } from "../../store/occurrences";

export const MINUTES_IN_DAY = 1440;
/** The shortest a block is drawn, so a 5-minute event can still be seen and clicked. */
export const MIN_BLOCK_MINUTES = 20;

export interface Placed {
  occ: Occurrence;
  /** Minutes from the start of the day. */
  top: number;
  /** Minutes the block spans on this day. */
  height: number;
  /** Which of `columns` side-by-side columns it sits in. */
  column: number;
  columns: number;
  /** True when something else is at the same time. */
  overlaps: boolean;
}

const minutesOf = (value: string) => Number(value.slice(11, 13)) * 60 + Number(value.slice(14, 16));

/** Whether an occurrence is drawn in the all-day row: an all-day event, or a timed one lasting a day or more. */
export function isAllDayLike(occ: Occurrence): boolean {
  return occ.allDay || wallMinutes(occ.end) - wallMinutes(occ.start) >= 1440;
}

/**
 * Lays out the timed occurrences of one day. Events that overlap in time, directly or through a
 * chain of others, form a cluster; each is given a column within its cluster so they sit side by
 * side, and the cluster shares the width.
 */
export function layoutDay(occurrences: readonly Occurrence[], day: string): Placed[] {
  const blocks = occurrences
    .filter((o) => !isAllDayLike(o) && touchesDay(o, day))
    .map((occ) => {
      const top = occ.start.slice(0, 10) < day ? 0 : minutesOf(occ.start);
      // An end at 00:00 of a later day runs to the end of this one.
      const end = occ.end.slice(0, 10) > day ? MINUTES_IN_DAY : minutesOf(occ.end);
      return { occ, top, height: Math.max(end - top, MIN_BLOCK_MINUTES) };
    })
    .sort((a, b) => a.top - b.top || b.height - a.height);

  const placed: Placed[] = [];
  let cluster: { occ: Occurrence; top: number; height: number; column: number }[] = [];
  let clusterEnd = -1;
  let columnEnds: number[] = [];

  const flush = () => {
    const columns = columnEnds.length;
    for (const b of cluster) placed.push({ ...b, columns, overlaps: cluster.length > 1 });
    cluster = [];
    columnEnds = [];
    clusterEnd = -1;
  };

  for (const b of blocks) {
    if (cluster.length > 0 && b.top >= clusterEnd) flush();
    let column = columnEnds.findIndex((end) => end <= b.top);
    if (column === -1) column = columnEnds.length;
    columnEnds[column] = b.top + b.height;
    clusterEnd = Math.max(clusterEnd, b.top + b.height);
    cluster.push({ ...b, column });
  }
  flush();
  return placed;
}

/** How many separate groups of events overlap, for the "Overlaps" count. */
export function countOverlaps(occurrencesByDay: ReadonlyMap<string, readonly Occurrence[]>): number {
  let n = 0;
  for (const [day, occs] of occurrencesByDay) {
    const placed = layoutDay(occs, day);
    // Clusters come out one after another; a new one starts when a block begins after the last ended.
    let end = -1;
    for (const p of placed) {
      if (!p.overlaps) continue;
      if (p.top >= end) n += 1;
      end = Math.max(end, p.top + p.height);
    }
  }
  return n;
}
