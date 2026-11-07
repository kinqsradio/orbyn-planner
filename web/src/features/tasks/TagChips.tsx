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

/** A tag as a small chip: the person's colour and name. */
export function TagChip({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) {
  return (
    <span className="tagchip">
      <Swatch colour={tag.colour} />
      {tag.name}
      {onRemove && (
        <button type="button" className="chip-x" aria-label={`Remove tag ${tag.name}`} onClick={onRemove}>
          ×
        </button>
      )}
    </span>
  );
}
