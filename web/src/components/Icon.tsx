import { ICONS, type IconName, type IconShape } from "./icons";

function Shape({ shape }: { shape: IconShape }) {
  switch (shape.t) {
    case "path":
      return <path d={shape.d} />;
    case "circle":
      return <circle cx={shape.cx} cy={shape.cy} r={shape.r} />;
    case "rect":
      return <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} />;
  }
}

export function Icon({ name, small = false, size }: { name: IconName; small?: boolean; size?: number }) {
  const shapes: IconShape[] = ICONS[name];
  return (
    <svg
      className={small ? "ic sm" : "ic"}
      viewBox="0 0 24 24"
      style={size ? { width: size, height: size } : undefined}
      aria-hidden="true"
    >
      {shapes.map((shape, i) => (
        <Shape key={i} shape={shape} />
      ))}
    </svg>
  );
}
