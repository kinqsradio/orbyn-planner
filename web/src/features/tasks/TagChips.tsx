import { LIST_COLOURS, type Tag, type Task } from "../../store/types";
import { Swatch } from "./TaskRow";

export const TAG_COLOUR_NAMES: Record<(typeof LIST_COLOURS)[number], string> = { c1: "Blue", c2: "Green", c3: "Purple", c4: "Orange" };

/** The tags a task carries that still exist: an id with no tag, or a deleted one, is hidden (the field stays on the task). */
export function shownTags(task: Pick<Task, "tags">, tags: readonly Tag[]): Tag[] {
  return task.tags.flatMap((id) => {
    const tag = tags.find((t) => t.id === id);
    return tag && tag.deletedAt === null ? [tag] : [];
  });
}

/**
 * What each live tag is called on screen. Two synced tags can end up with the same name (two devices made one at once); both
 * show, and every one after the first is marked "(2)", "(3)", … The order is by id, the same on every device. Nothing is merged.
 */
export function tagLabels(tags: readonly Tag[]): Map<string, string> {
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const t of [...tags].filter((x) => x.deletedAt === null).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const key = t.name.trim().toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    out.set(t.id, n === 1 ? t.name : `${t.name} (${n})`);
  }
  return out;
}

/** A tag as a small chip: the person's colour and name. */
export function TagChip({ tag, label = tag.name, onRemove }: { tag: Tag; label?: string; onRemove?: () => void }) {
  return (
    <span className="tagchip">
      <Swatch colour={tag.colour} />
      {label}
      {onRemove && (
        <button type="button" className="chip-x" aria-label={`Remove tag ${label}`} onClick={onRemove}>
          ×
        </button>
      )}
    </span>
  );
}
