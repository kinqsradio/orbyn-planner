import { encode } from "uqr";

/**
 * A QR code made here, on the device, from the text it is given (no request, nothing leaves the page). Always dark on light with a
 * quiet zone of its own, whatever the theme, because that is what scanners read.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { data, size } = encode(value, { ecc: "M", border: 0 });
  const quiet = 3;
  const total = size + quiet * 2;
  const path: string[] = [];
  data.forEach((row, y) => {
    let x = 0;
    while (x < size) {
      if (!row[x]) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < size && row[x + run]) run++;
      path.push(`M${x + quiet} ${y + quiet}h${run}v1h-${run}z`);
      x += run;
    }
  });
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${total} ${total}`} shapeRendering="crispEdges" style={{ width: "var(--sp-176)", height: "var(--sp-176)", background: "var(--qr-paper)", borderRadius: "var(--r-8)", flex: "none" }}>
      <path d={path.join("")} style={{ fill: "var(--qr-ink)" }} />
    </svg>
  );
}
