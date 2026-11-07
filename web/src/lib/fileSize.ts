/** "84 kB", "2.4 MB": the size the browser saved, one decimal below ten and whole numbers above, as the designs write it. */
export function fileSize(bytes: number): string {
  const unit = (n: number, name: string) => `${n < 10 ? (Math.round(n * 10) / 10).toString() : Math.round(n)} ${name}`;
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return unit(bytes / 1000, "kB");
  return unit(bytes / 1_000_000, "MB");
}
