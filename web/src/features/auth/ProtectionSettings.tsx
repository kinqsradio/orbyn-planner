import { useCallback, useEffect, useState } from "react";
import { ApiFailure } from "../../api/auth";
import { useAuth } from "../../auth/AuthProvider";
import { changedKey, readConfirmed, readSkipped, seenKey, writeConfirmed, writeSkipped } from "../../auth/protectionNotice";
import { confirmProtection, readProtection, type ProtectionReport } from "../../auth/flows";
import type { ProtectionLevel } from "../../generated/ProtectionLevel";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { MONTHS, formatTime } from "../../lib/dates";
import { describeError } from "./AuthScreens";

/** Why the walk of the chain stopped, for the reasons the designs do not draw (the engine's reasons). */
const REASONS: Record<string, string> = {
  invalid_signature: "The newest setting’s signature didn’t check out.",
  gap: "Some settings in between are missing.",
  invalid: "The newest setting isn’t valid.",
};

const KEEPS = "keeps the setting it last confirmed";

/** What the card says about each way a setting can fail to confirm, as the designs draw them. */
const REASON_LINES = {
  rollback: `The server showed an older setting than this device has already confirmed. This device ${KEEPS} until a trusted device confirms it again.`,
  fork: `The server showed two different settings. This device ${KEEPS} until a trusted device confirms it again.`,
  unknownDevice: `The latest change is signed by a device this device doesn’t know. This device ${KEEPS}.`,
} as const;

type Kind = "verified" | "confirming" | "rollback" | "fork" | "unknownDevice" | "other";

function kindOf(report: ProtectionReport): Kind {
  if (report.problem === "rollback") return "rollback";
  if (report.problem === "fork") return "fork";
  if (report.stopped === "untrusted_signer") return "unknownDevice";
  if (report.state === "verified") return "verified";
  if (report.state === "provisional" && !report.stopped) return "confirming";
  return "other";
}

const levelName = (level: string | null | undefined) => (level === "advanced" ? "Advanced" : "Standard");
const day = (secs: number) => {
  const d = new Date(secs * 1000);
  return `${d.getDate()} ${MONTHS[d.getMonth()]!.slice(0, 3)}`;
};
/** "today 09:41" for the same day, otherwise "3 Nov". */
const when = (secs: number, now: Date) => {
  const d = new Date(secs * 1000);
  return d.toDateString() === now.toDateString() ? `today ${formatTime(d)}` : day(secs);
};
const secsOf = (link: { signed_at: bigint | number }) => Number(link.signed_at);

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

/** The first signing never happened, so there is no setting to confirm: pick one. Not in the designs yet, so it is the earlier dialog. */
function ChooseDialog({ report, onClose, onDone, onConflict }: { report: ProtectionReport; onClose: () => void; onDone: () => void; onConflict: () => void }) {
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
        <p className="t3 small">Choose the level you want. This device signs it, and every device of your account will check that signature.</p>
        <div className="form" style={{ width: "auto" }} role="radiogroup" aria-label="Protection level">
          <label style={{ display: "flex", gap: "var(--sp-8)", alignItems: "flex-start" }}>
            <input type="radio" name="level" checked={level === "standard"} onChange={() => setLevel("standard")} />
            <span>
              <b style={{ fontWeight: "var(--fw-medium)" }}>Standard</b>
              <span className="t3 small" style={{ display: "block" }}>Orbyn holds a key that can open your planner so it can help you recover your account. Orbyn can read your data.</span>
            </span>
          </label>
          <label style={{ display: "flex", gap: "var(--sp-8)", alignItems: "flex-start", opacity: 0.6 }}>
            <input type="radio" name="level" disabled />
            <span>
              <b style={{ fontWeight: "var(--fw-medium)" }}>Advanced</b>
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


/** "Confirm your protection level": the setting the server has, who set it and when, to confirm on this device. Not now leaves it for later. */
function ConfirmDialog({ report, changedNow, onClose, onNotNow, onDone, onConflict }: { report: ProtectionReport; changedNow: string | null; onClose: () => void; onNotNow: () => void; onDone: () => void; onConflict: () => void }) {
  const auth = useAuth()!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const head = report.head!;
  const setBy = report.signer?.name ?? "another device";
  const [openedAt] = useState(() => Date.now() / 1000);
  const age = openedAt - secsOf(head);
  const sign = async () => {
    if (!auth.session) return;
    setBusy(true);
    setError(null);
    try {
      await confirmProtection(auth.services, auth.session, head.level, head);
      onDone();
    } catch (e) {
      setBusy(false);
      // Another device signed first: the screen reads the chain again and this dialog shows the new setting, to be checked and confirmed again.
      if (e instanceof ApiFailure && e.code === "protection_conflict") onConflict();
      else setError(describeError(e));
    }
  };
  return (
    <Modal label="Confirm your protection level" onClose={busy ? () => undefined : onClose}>
      <div>
        <b className="card-title">Confirm your protection level</b>
        {changedNow && (
          <div className="banner info" role="status" style={{ marginTop: "var(--sp-8)" }}>
            <Icon name="info" small />
            Protection was just changed on {changedNow}, so this shows the current setting. Check it and confirm again.
          </div>
        )}
        <p className="t3">
          {head.level === "standard" ? (
            <>Your account uses <b style={{ fontWeight: "var(--fw-medium)" }}>Standard protection</b>: data is encrypted on your devices, and Orbyn keeps a recovery copy of the keys. Confirming lets this device check every later change.</>
          ) : (
            <>Your account uses <b style={{ fontWeight: "var(--fw-medium)" }}>Advanced protection</b>: only your devices hold the keys. Confirming lets this device check every later change.</>
          )}
        </p>
        <div className="kv"><span>Set on</span><b>{setBy} · {age < 60 ? "just now" : day(secsOf(head))}</b></div>
        {error && <p className="err" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="ghost" data-autofocus disabled={busy} onClick={onNotNow}>Not now</button>
          <button type="button" className="btn" disabled={busy} onClick={() => void sign()}>{busy ? "Confirming…" : "Confirm"}</button>
        </div>
      </div>
    </Modal>
  );
}

/** The versions and devices involved, for support. */
function DetailsDialog({ report, confirmed, onClose }: { report: ProtectionReport; confirmed: { seq: number; level: string } | null; onClose: () => void }) {
  const now = new Date();
  return (
    <Modal label="Protection details" onClose={onClose}>
      <div>
        <b className="card-title">Protection details</b>
        <div className="kv"><span>Newest setting on the server</span><b>{report.head ? `${levelName(report.head.level)} · ${report.head.seq}` : "None"}</b></div>
        {report.head && <div className="kv"><span>Signed by</span><b>{report.signer?.name ?? "A device this account doesn’t list"}{report.signer?.thisDevice ? " (this device)" : ""} · {when(secsOf(report.head), now)}</b></div>}
        <div className="kv"><span>Last confirmed on this device</span><b>{confirmed ? `${levelName(confirmed.level)} · ${confirmed.seq}` : "None"}</b></div>
        {report.stopped && <div className="kv"><span>Stopped at</span><b>{report.stopped}</b></div>}
        {report.problem && <div className="kv"><span>Problem</span><b>{report.problem}</b></div>}
        <div className="dialog-actions">
          <button type="button" className="ghost" data-autofocus onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Settings · Privacy · Protection: the level as this device verified it from the server's signed chain, never the server's word.
 * Verified, Confirming and Can't confirm are drawn in Orbyn Account Designs. After a rollback or a fork there is no head to sign
 * after, so nothing offers to confirm: the way on is a trusted device. Advanced is shown as Planned.
 */
export function ProtectionSettings({ onReviewDevices }: { onReviewDevices?: () => void } = {}) {
  const auth = useAuth();
  const [report, setReport] = useState<ProtectionReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [details, setDetails] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(true);
  /** Who changed protection while the confirm dialog was open: named in its blue line. */
  const [changedNow, setChangedNow] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const session = auth?.session ?? null;
  const services = auth?.services;
  const trusted = session?.deviceState === "trusted";

  /** Takes what the engine verified; a change by another device is remembered until the person dismisses it. */
  const accept = useCallback(
    (next: ProtectionReport) => {
      if (session && next.state === "verified" && next.head && next.seq === next.head.seq) {
        writeConfirmed(session.accountId, { seq: next.head.seq, level: next.head.level, at: secsOf(next.head) });
      }
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

  const load = useCallback(async (): Promise<ProtectionReport | null> => {
    if (!services || !session) return null;
    setError(null);
    try {
      const next = await readProtection(services, session);
      accept(next);
      return next;
    } catch (e) {
      setError(describeError(e));
      return null;
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
  // Only a setting this device verified may name a device: a fork or an unverified head names no one.
  const showChanged = changed !== null && report?.state === "verified" && report.seq === changed.seq && changed.seq > Math.max(readSeen(accountId), dismissed);
  const kind = report ? kindOf(report) : null;
  const confirmed = readConfirmed(accountId);
  const level = levelName(report?.level);
  const now = new Date();
  // Shown once per device: a setting this device has not confirmed, with nothing wrong with it. "Not now" is remembered for that setting.
  const askToConfirm = report !== null && report.head !== null && kind === "confirming" && confirmOpen && report.head.seq > Math.max(readSkipped(accountId), skipped);

  return (
    <>
      <div className="bh"><b>Protection</b><span></span></div>
      {showChanged && changed && report?.head && (
        <div className="banner" role="status" style={{ marginBottom: "var(--sp-8)" }}>
          <Icon name="info" small />
          <span>Protection was changed to {levelName(report.head.level)} on <b style={{ fontWeight: "var(--fw-medium)" }}>{changed.name ?? "another device"} · {when(secsOf(report.head), now)}</b></span>
          <div className="end">
            <button type="button" className="ghost sm" onClick={() => setDetails(true)}>Review</button>
            <button type="button" className="ghost sm" onClick={() => { writeSeen(accountId, changed!.seq); setDismissed(changed!.seq); }}>Dismiss</button>
          </div>
        </div>
      )}
      <div aria-label="Protection" style={{ display: "flex", flexDirection: "column", gap: "var(--sp-8)" }}>
      <div className={`card pv-card${kind === "verified" || kind === "confirming" ? "" : " err"}`}>
        {error ? (
          <>
            <span className="err" role="alert">{error}</span>
            <div><button type="button" className="ghost" onClick={() => void load()}>Try again</button></div>
          </>
        ) : !report ? (
          <span className="t3">Checking…</span>
        ) : kind === "verified" ? (
          <>
            <div className="pv-head">
              <Icon name="shield" small />
              <b style={{ fontWeight: "var(--fw-medium)" }}>{level} protection</b>
              <span className="st ok"><span className="sd" />Verified</span>
            </div>
            <span className="t2 pv-text">
              Confirmed by your devices.
              {report.head && ` Last change ${day(secsOf(report.head))}${report.signer?.name ? ` on ${report.signer.name}` : ""}.`}
            </span>
          </>
        ) : kind === "confirming" ? (
          <>
            <div className="pv-head">
              <Icon name="shield" small />
              <b style={{ fontWeight: "var(--fw-medium)" }}>{level} protection</b>
              <span className="st info"><span className="sd" />Confirming</span>
            </div>
            <span className="t2 pv-text">Confirmed on this device. Your other devices confirm it the next time they open.</span>
          </>
        ) : (
          <>
            <div className="pv-head">
              <Icon name="shield" small />
              <b style={{ fontWeight: "var(--fw-medium)" }}>
                {report.level ? `${level} protection` : "Protection"}
                {report.level && confirmed ? `, last confirmed ${day(confirmed.at)}` : ""}
                {!report.level ? " can’t be confirmed on this device" : ""}
              </b>
              <span className="st err"><span className="sd" />Can’t confirm</span>
            </div>
            <span className="t2 pv-text">
              {kind === "rollback" ? REASON_LINES.rollback
                : kind === "fork" ? REASON_LINES.fork
                : kind === "unknownDevice" ? REASON_LINES.unknownDevice
                : report.stopped ? (REASONS[report.stopped] ?? "This device couldn’t verify the newest setting.")
                : report.head ? "This device hasn’t verified any setting yet."
                : "No setting has been signed yet."}
            </span>
            <div className="pv-line">
              {kind === "rollback" || kind === "fork" ? (
                <span className="pv-line"><Icon name="laptop" small />Open Orbyn on a trusted device to fix this.</span>
              ) : kind === "unknownDevice" ? (
                <button type="button" className="btn sm" onClick={onReviewDevices}>Review devices</button>
              ) : !report.head ? (
                <button type="button" className="ghost sm" onClick={() => setChoosing(true)}>Confirm protection level</button>
              ) : null}
              {report.head && <button type="button" className="ghost sm" onClick={() => setDetails(true)}>Details</button>}
            </div>
          </>
        )}
      </div>
      <div className="srow" style={{ opacity: 0.6 }}>
        <div className="lab2"><b>Advanced protection</b><small>Only your devices hold the keys.</small></div>
        <span className="st planned"><span className="sd" />Planned</span>
      </div>
      </div>
      {details && report && <DetailsDialog report={report} confirmed={confirmed} onClose={() => setDetails(false)} />}
      {askToConfirm && report?.head && (
        <ConfirmDialog
          report={report}
          changedNow={changedNow}
          onClose={() => setConfirmOpen(false)}
          onNotNow={() => {
            writeSkipped(accountId, report.head!.seq);
            setSkipped(report.head!.seq);
            setChangedNow(null);
          }}
          onDone={() => {
            setChangedNow(null);
            void load(); // the setting is now confirmed here: the card shows it
          }}
          onConflict={() => {
            // The setting on the screen is now the other device's: named in the blue line.
            void load().then((next) => next && setChangedNow(next.signer?.name ?? "another device"));
          }}
        />
      )}
      {choosing && report && (
        <ChooseDialog
          report={report}
          onClose={() => {
            setChoosing(false);
            void load(); // what the engine learned meanwhile is shown, whether or not anything was signed
          }}
          onDone={() => {
            setChoosing(false);
            void load();
          }}
          onConflict={() => void load()}
        />
      )}
    </>
  );
}
