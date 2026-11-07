/** The designs' switch: a small track with a knob. `on` is how it looks (a blocked switch looks on); `checked` is what it says to a screen reader. */
export function Toggle({ label, on, checked, onChange, disabled }: { label: string; on: boolean; checked?: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked ?? on} aria-label={label} className={on ? "tgl on" : "tgl"} disabled={disabled} onClick={() => onChange(!(checked ?? on))} />
  );
}
