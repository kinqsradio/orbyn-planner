import { useCallback, useEffect, useState } from "react";
import { ApiFailure } from "../../api/auth";
import { useAuth } from "../../auth/AuthProvider";
import { confirmProtection, readProtection, type ProtectionReport } from "../../auth/flows";
import type { ProtectionLevel } from "../../generated/ProtectionLevel";
import { Modal } from "../../components/Modal";
import { describeError } from "./AuthScreens";

/** Why the walk of the chain stopped, in words a person can use (the engine's reasons). */
const REASONS: Record<string, string> = {
  untrusted_signer: "The newest setting was signed by a device this device doesn’t trust, such as one that was removed.",
  invalid_signature: "The newest setting’s signature didn’t check out.",
  gap: "Some settings in between are missing.",
  invalid: "The newest setting isn’t valid.",
};

function reasonOf(report: ProtectionReport): string {
  if (report.problem === "rollback") return "The server showed an older setting than this device had already verified.";
  if (report.problem === "fork") return "The server showed a different setting than the one this device had already verified.";
  if (report.stopped) return REASONS[report.stopped] ?? "This device couldn’t verify the newest setting.";
  if (report.state === "unknown") return report.head ? "This device hasn’t verified any setting yet." : "No setting has been signed yet.";
  return "This device hasn’t verified the newest setting yet.";
}

const seenKey = (accountId: string) => `orbyn-planner.protection-changed.${accountId}`;

/** The "changed on another device" notice outlives the screen until it is dismissed: it is kept for the sequence it was about. */
function readSeen(accountId: string): number {
  try {
    return Number(localStorage.getItem(seenKey(accountId)) ?? 0) || 0;
  } catch {
    return 0;
  }
}
function writeSeen(accountId: string, seq: number) {
  try {
    localStorage.setItem(seenKey(accountId), String(seq));
  } catch {
    // Not remembered across visits; fine.
  }
}
const changedKey = (accountId: string) => `orbyn-planner.protection-changed-by.${accountId}`;

function ConfirmDialog({ report, onClose, onDone, onConflict }: { report: ProtectionReport; onClose: () => void; onDone: () => void; onConflict: () => void }) {
  const auth = useAuth()!;
  const [level, setLevel] = useState<ProtectionLevel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sign = async () => {
    if (!level || !auth.session) return;
    setBusy(true);
    setError(null);
    try {
      await confirmProtection(auth.services, auth.session, level, report.head);
      onDone();
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
      if (e instanceof ApiFailure && e.code === "protection_conflict") {
        // Another device signed first: the screen shows the new state, and the person chooses again from it.
        setLevel(null);
        onConflict();
      }
    }
  };
  return (
    <Modal label="Confirm protection level" onClose={busy ? () => undefined : onClose}>
      <div>
        <b className="card-title">Confirm your protection level</b>
        <p className="t3 small">{reasonOf(report)} Choose the level you want. This device signs it, and every device of your account will check that signature.</p>
        <div className="form" style={{ width: "auto" }} role="radiogroup" aria-label="Protection level">
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input type="radio" name="level" checked={level === "standard"} onChange={() => setLevel("standard")} />
            <span>
              <b style={{ fontWeight: 500 }}>Standard</b>
              <span className="t3 small" style={{ display: "block" }}>Orbyn holds a key that can open your planner so it can help you recover your account. Orbyn can read your data.</span>
            </span>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", opacity: 0.6 }}>
            <input type="radio" name="level" disabled />
            <span>
              <b style={{ fontWeight: 500 }}>Advanced</b>
              <span className="t3 small" style={{ display: "block" }}>Coming later.</span>
            </span>
          </label>
        </div>
        {error && <p className="err" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="btn" disabled={busy || !level} onClick={() => void sign()}>{busy ? "Signing…" : "Sign this setting"}</button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Settings · Privacy · Protection: the level as this device verified it from the server's signed chain, never the server's word.
 * Verified Standard says plainly that Orbyn can read Standard data. Anything this device can't confirm says so and why, and offers
 * "Confirm protection level", which signs only the level the person picks. Advanced is shown and disabled. The design has no
 * Protection screen yet, so the wording here is ours (from the engine's key-service design) for review.
 */
export function ProtectionSettings() {
  const auth = useAuth();
  const [report, setReport] = useState<ProtectionReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [dismissed, setDismissed] = useState(0);
  const session = auth?.session ?? null;
  const services = auth?.services;
  const trusted = session?.deviceState === "trusted";

  /** Takes what the engine verified; a change by another device is remembered until the person dismisses it. */
  const accept = useCallback(
    (next: ProtectionReport) => {
      if (next.changedBy && next.head && session) {
        try {
          localStorage.setItem(changedKey(session.accountId), JSON.stringify({ seq: next.head.seq, name: next.changedBy.name }));
        } catch {
          // The notice then shows only on this visit.
        }
      }
      setReport(next);
    },
    [session],
  );

  const load = useCallback(async () => {
    if (!services || !session) return;
    setError(null);
    try {
      accept(await readProtection(services, session));
    } catch (e) {
      setError(describeError(e));
    }
  }, [services, session, accept]);

  useEffect(() => {
    if (!trusted || !services || !session) return;
    let live = true;
    readProtection(services, session).then(
      (next) => live && accept(next),
      (e: unknown) => live && setError(describeError(e)),
    );
    return () => {
      live = false;
    };
  }, [trusted, services, session, accept]);

  if (!auth?.session || !trusted) return null;
  const accountId = auth.session.accountId;
  let changed: { seq: number; name: string | null } | null = null;
  try {
    const raw = localStorage.getItem(changedKey(accountId));
    changed = raw ? (JSON.parse(raw) as { seq: number; name: string | null }) : null;
  } catch {
    changed = null;
  }
  const showChanged = changed !== null && report?.head?.seq === changed.seq && changed.seq > Math.max(readSeen(accountId), dismissed);
  const verified = report?.state === "verified";

  return (
    <>
      <div className="bh"><b>Protection</b><span></span></div>
      <div className="card" style={{ gap: 8, padding: "12px 14px" }} aria-label="Protection">
        {error ? (
          <>
            <span className="err" role="alert">{error}</span>
            <div><button type="button" className="ghost" onClick={() => void load()}>Try again</button></div>
          </>
        ) : !report ? (
          <span className="t3">Checking…</span>
        ) : verified && report.level === "standard" ? (
          <>
            <b style={{ fontWeight: 500 }}>Standard protection</b>
            <span className="t3 small">Orbyn can help you recover your account if you lose every device. To make that possible, Orbyn holds a key that can open your planner, so under Standard Orbyn can read your data.</span>
          </>
        ) : verified && report.level === "advanced" ? (
          <>
            <b style={{ fontWeight: 500 }}>Advanced protection</b>
            <span className="t3 small">Only your own devices can open your planner. Orbyn can’t read it, and can’t help you recover it if you lose every device.</span>
          </>
        ) : (
          <>
            <b style={{ fontWeight: 500 }}>Your protection level can’t be confirmed on this device</b>
            <span className="t3 small">{reasonOf(report)}</span>
            {report.state === "provisional" && report.level && (
              <span className="t3 small">The last setting this device verified is {report.level === "standard" ? "Standard" : "Advanced"}, but it may not be the newest, so nothing relies on it.</span>
            )}
            <div><button type="button" className="ghost" onClick={() => setConfirming(true)}>Confirm protection level</button></div>
          </>
        )}
        {showChanged && changed && (
          <div role="status" style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
            <span className="t3 small">Protection was changed on {changed.name ?? "another device"}.</span>
            <button type="button" className="ghost" onClick={() => { writeSeen(accountId, changed!.seq); setDismissed(changed!.seq); }}>Dismiss</button>
          </div>
        )}
        <div className="kv" style={{ opacity: 0.6 }}>
          <span>Advanced protection</span>
          <button type="button" className="ghost" disabled>Coming later</button>
        </div>
      </div>
      {confirming && report && (
        <ConfirmDialog
          report={report}
          onClose={() => {
            setConfirming(false);
            void load(); // what the engine learned meanwhile is shown, whether or not anything was signed
          }}
          onDone={() => {
            setConfirming(false);
            void load();
          }}
          onConflict={() => void load()}
        />
      )}
    </>
  );
}
