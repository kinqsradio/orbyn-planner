import { ICONS, type IconName } from "./icons";

export function Icon({ name, small = false, size }: { name: IconName; small?: boolean; size?: number }) {
  return (
    <svg
      className={small ? "ic sm" : "ic"}
      viewBox="0 0 24 24"
      style={size ? { width: size, height: size } : undefined}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}
