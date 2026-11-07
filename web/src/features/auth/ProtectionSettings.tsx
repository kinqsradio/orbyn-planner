import { useCallback, useEffect, useState } from "react";
import { Planned } from "../../components/Planned";
import { ApiFailure } from "../../api/auth";
import { useAuth } from "../../auth/AuthProvider";
import { PAUSED_PROTECTION_HINT, useDeletionPaused } from "../../auth/deletionNotice";
import { pendingChange, readConfirmed, readSkipped, recordReport, writeSeen, writeSkipped, type ConfirmedSetting } from "../../auth/protectionNotice";
import { confirmProtection, readProtection, type ProtectionReport } from "../../auth/flows";
import type { ProtectionLevel } from "../../generated/ProtectionLevel";
import { BusyButton } from "../../components/BusyButton";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { MONTHS, formatTime } from "../../lib/dates";
import { motionMs } from "../../styles/tokens";
import { describeError } from "./AuthScreens";

const KEEPS = "This browser keeps the setting it last confirmed";

/** What the card says about each way a setting can fail to confirm, as Orbyn Account Designs draw them ("this browser" on the web). */
const REASON_LINES = {
  rollback: { reason: "The server showed an older setting", line: `The server showed an older setting than this browser has already confirmed. ${KEEPS} until a trusted device confirms it again.` },
  fork: { reason: "The server showed two different settings", line: `The server showed two different settings. ${KEEPS} until a trusted device confirms it again.` },
  unknownDevice: { reason: "Signed by a device this one doesn’t know", line: `The latest change is signed by a device this browser doesn’t know. ${KEEPS}.` },
  unlisted: { reason: "Signed by a device this account doesn’t list", line: `The latest change is signed by a device this account doesn’t list. ${KEEPS}.` },
  badSignature: { reason: "A signature doesn’t check out", line: `The latest change has a signature that doesn’t check out. ${KEEPS}.` },
  gap: { reason: "Some changes are missing", line: `Some changes are missing between the setting this browser confirmed and the newest one. ${KEEPS}.` },
  invalid: { reason: "A change this device can’t read", line: `One of the changes isn’t in a form this browser can read. ${KEEPS}.` },
} as const;

type Kind = "verified" | "confirming" | "unset" | keyof typeof REASON_LINES;

function kindOf(report: ProtectionReport): Kind {
  if (report.problem === "rollback") return "rollback";
  if (report.problem === "fork") return "fork";
  // A signer the account doesn't list at all, or one it lists that this browser doesn't know.
  if (report.stopped === "untrusted_signer") return report.signer?.name ? "unknownDevice" : "unlisted";
  if (report.stopped === "invalid_signature") return "badSignature";
  if (report.stopped === "gap") return "gap";
  if (report.stopped === "invalid") return "invalid";
  if (report.state === "verified") return "verified";
  if (report.state === "provisional") return "confirming";
  // Unknown with nothing stopping it: no device has signed a setting yet.
  return "unset";
}

/** True once `active` has been true for the wait (400 ms): a loading state shows only after it. */
function useAfter(active: boolean): boolean {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setDone(true), motionMs("wait"));
    return () => {
      clearTimeout(timer);
      setDone(false);
    };
  }, [active]);
  return active && done;
}

export const levelName = (level: string | null | undefined) => (level === "advanced" ? "Advanced" : "Standard");
const day = (secs: number) => {
  const d = new Date(secs * 1000);
  return `${d.getDate()} ${MONTHS[d.getMonth()]!.slice(0, 3)}`;
};
/** "today 09:41" for the same day, otherwise "3 Nov". */
export const when = (secs: number, now: Date) => {
  const d = new Date(secs * 1000);
  return d.toDateString() === now.toDateString() ? `today ${formatTime(d)}` : day(secs);
};
const secsOf = (link: { signed_at: bigint | number }) => Number(link.signed_at);

/** "Confirm your protection level": the setting the server has, who set it and when, to confirm on this browser. Not now leaves it for later. With no setting yet, Standard is the one offered. */
function ConfirmDialog({ report, changedNow, onClose, onNotNow, onDone, onConflict }: { report: ProtectionReport; changedNow: string | null; onClose: () => void; onNotNow: () => void; onDone: () => void; onConflict: () => void }) {
  const auth = useAuth()!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const head = report.head;
  const level: ProtectionLevel = head?.level ?? "standard";
  const setBy = report.signer?.name ?? "another device";
  const [openedAt] = useState(() => Date.now() / 1000);
  const sign = async () => {
    if (!auth.session) return;
    setBusy(true);
    setError(null);
    try {
      await confirmProtection(auth.services, auth.session, level, head);
      onDone();
    } catch (e) {
      setBusy(false);
      // Another device signed first: the screen reads the chain again and this dialog shows the new setting, to be checked and confirmed again.
      if (e instanceof ApiFailure && e.code === "protection_conflict") onConflict();
      else setError("Couldn’t confirm. Check your connection and try again.");
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
          {!head ? (
            <>No device has set a protection level for this account yet. Confirming sets <b style={{ fontWeight: "var(--fw-medium)" }}>Standard protection.</b></>
          ) : level === "standard" ? (
            <>Your account uses <b style={{ fontWeight: "var(--fw-medium)" }}>Standard protection</b>: data is encrypted on your devices, and only your trusted devices hold the keys; Standard’s recovery copy is Planned. Confirming lets this browser check every later change.</>
          ) : (
            <>Your account uses <b style={{ fontWeight: "var(--fw-medium)" }}>Advanced protection</b>: only your devices hold the keys. Confirming lets this browser check every later change.</>
          )}
        </p>
        {head && <div className="kv"><span>Set on</span><b>{setBy} · {openedAt - secsOf(head) < 60 ? "just now" : day(secsOf(head))}</b></div>}
        <div className="dialog-actions">
          <button type="button" className="ghost" data-autofocus disabled={busy} onClick={onNotNow}>Not now</button>
          <BusyButton className="btn" busy={busy} idle={head ? "Confirm" : "Set Standard protection"} working="Confirming…" onClick={() => void sign()} />
        </div>
        {error && <p className="err" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

/** For the person or Orbyn support: the reason, the newest setting and who signed it, and what this browser last confirmed. Nothing in it is secret. */
function DetailsDialog({ report, kind, confirmed, onClose, onReviewDevices }: { report: ProtectionReport; kind: Kind; confirmed: ConfirmedSetting | null; onClose: () => void; onReviewDevices?: () => void }) {
  const reason = kind in REASON_LINES ? REASON_LINES[kind as keyof typeof REASON_LINES].reason : null;
  const rows: Array<[string, string]> = [];
  if (reason) rows.push(["Reason", reason]);
  if (report.head) {
    rows.push(["Newest setting on the server", `${levelName(report.head.level)} · change ${report.head.seq}`]);
    const at = new Date(secsOf(report.head) * 1000);
    rows.push(["Signed by", `${report.signer?.name ?? "A device this account doesn’t list"} · ${at.getDate()} ${MONTHS[at.getMonth()]!.slice(0, 3)} ${formatTime(at)}`]);
  }
  if (confirmed) rows.push(["Last confirmed on this browser", `${levelName(confirmed.level)} · change ${confirmed.seq} · ${day(confirmed.at)}`]);
  const copy = () => void navigator.clipboard?.writeText(rows.map(([k, v]) => `${k}: ${v}`).join("\n")).catch(() => undefined);
  return (
    <Modal label="Protection details" onClose={onClose}>
      <div className="pv-dialog">
        <b className="card-title">Protection details</b>
        <p className="t3">For you or Orbyn support. Nothing here is secret.</p>
        <div>
          {rows.map(([k, v]) => (
            <div className="kv" key={k}><span>{k}</span><b>{v}</b></div>
          ))}
        </div>
        {kind === "unlisted" && <span className="t3 small">The device has no name because this account doesn’t list it. If you don’t recognise it, review your devices.</span>}
        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={copy}><Icon name="copy" small />Copy details</button>
          {kind === "unlisted" ? (
            <button type="button" className="btn" data-autofocus onClick={() => { onClose(); onReviewDevices?.(); }}>Review devices</button>
          ) : (
            <button type="button" className="btn" data-autofocus onClick={onClose}>Done</button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Standard is the level in use and the only one that can be chosen, so it is the selected radio; any other level keeps the shield. */
function ProtectionMark({ standard }: { standard: boolean }) {
  return standard ? <StandardRadio /> : <Icon name="shield" small />;
}

/** The two protection levels are a radio group: Standard is checked and the one tab stop; Advanced is Planned, so disabled. Arrow keys have nowhere to go. */
const stayPut = (e: React.KeyboardEvent) => {
  if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
};
function StandardRadio() {
  return <span className="radio on" role="radio" aria-checked="true" aria-label="Standard protection" tabIndex={0} onKeyDown={stayPut} />;
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
  const [details, setDetails] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const paused = useDeletionPaused();
  const [confirmOpen, setConfirmOpen] = useState(true);
  /** Who changed protection while the confirm dialog was open: named in its blue line. */
  const [changedNow, setChangedNow] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const session = auth?.session ?? null;
  const services = auth?.services;
  const slow = useAfter(report === null && error === null);
  const trusted = session?.deviceState === "trusted";

  /** Takes what the engine verified; a change by another device is remembered until the person dismisses it. */
  const accept = useCallback(
    (next: ProtectionReport) => {
      if (session) recordReport(session.accountId, next);
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

  // Shown once per device: a setting this browser has not confirmed, with nothing wrong with it. "Not now" is remembered for that setting.
  const autoAsk =
    session !== null && report !== null && kindOf(report) === "confirming" && report.head !== null && confirmOpen && report.head.seq > Math.max(readSkipped(session.accountId), skipped);
  if (!auth?.session || !trusted) return null;
  const accountId = auth.session.accountId;
  // Only a setting this browser verified may name a device: a fork or an unverified head names no one.
  const changed = pendingChange(accountId, report, dismissed);
  const kind = report ? kindOf(report) : null;
  const confirmed = readConfirmed(accountId);
  const level = levelName(report?.level);
  const now = new Date();
  // With no setting yet, it opens when the person chooses. 
  const askToConfirm = report !== null && !paused && (choosing || autoAsk);
  const problemKind = kind !== null && kind in REASON_LINES ? (kind as keyof typeof REASON_LINES) : null;
  const confirmedOn = report?.level && confirmed ? `, last confirmed ${day(confirmed.at)}` : ", last confirmed on this browser";

  return (
    <>
      <div className="bh"><b>Protection</b><span></span></div>
      {changed && report?.head && (
        <div className="banner" role="status" style={{ marginBottom: "var(--sp-8)" }}>
          <Icon name="info" small />
          <span>Protection was changed to {levelName(report.head.level)} on <b style={{ fontWeight: "var(--fw-medium)" }}>{changed.name ?? "another device"} · {when(changed.at, now)}</b></span>
          <div className="end">
            <button type="button" className="ghost sm" onClick={() => setDetails(true)}>Review</button>
            <button type="button" className="ghost sm" onClick={() => { writeSeen(accountId, changed.seq); setDismissed(changed.seq); }}>Dismiss</button>
          </div>
        </div>
      )}
      <div aria-label="Protection" role="radiogroup" className="pv-cards">
      <div className={`card pv-card${error ? " pv-err" : kind === "verified" || kind === "confirming" || kind === "unlisted" || kind === "unset" || !report ? "" : " pv-bad"}`}>
        {error ? (
          <>
            <div className="pv-head">
              <span className="pv-red"><Icon name="alert" small /></span>
              <b style={{ fontWeight: "var(--fw-medium)" }} role="alert">Couldn’t check protection</b>
            </div>
            <span className="t2 pv-text">Orbyn didn’t answer. This device keeps the setting it last confirmed.</span>
            <div><button type="button" className="btn sm" onClick={() => void load()}>Try again</button></div>
          </>
        ) : !report ? (
          // Nothing for the first 400 ms: a quick answer should not flash a loading state.
          slow && (
            <>
              <div className="pv-head"><Icon name="shield" small /><b style={{ fontWeight: "var(--fw-medium)" }}>Protection</b></div>
              <div className="pv-loading t3" role="status"><span className="spin blue" aria-hidden="true" />Checking protection…</div>
              <span className="skel" style={{ width: "70%" }} />
              <span className="skel" style={{ width: "45%" }} />
            </>
          )
        ) : kind === "verified" ? (
          <>
            <div className="pv-head">
              <ProtectionMark standard={report.level === "standard"} />
              <b style={{ fontWeight: "var(--fw-medium)" }}>{level} protection</b>
              <span className="st ok"><span className="sd" />Verified</span>
            </div>
            <span className="t2 pv-text">
              Confirmed by your devices.
              {report.head && ` Last change ${day(secsOf(report.head))}${report.signer?.name ? ` on ${report.signer.name}` : ""}.`}
              {report.level === "standard" && <><br /><span className="t3">Your planner is encrypted on your devices. Right now only your trusted devices hold your keys, and Orbyn holds no copy of them. Standard’s recovery copy, account recovery and server push and email reminders are <Planned />, and so is Advanced protection.</span></>}
            </span>
          </>
        ) : kind === "confirming" ? (
          <>
            <div className="pv-head">
              <ProtectionMark standard={report.level === "standard"} />
              <b style={{ fontWeight: "var(--fw-medium)" }}>{level} protection</b>
              <span className="st info"><span className="sd" />Confirming</span>
            </div>
            <span className="t2 pv-text">Confirmed on this browser. Your other devices confirm it the next time they open.</span>
          </>
        ) : kind === "unset" ? (
          <>
            <div className="pv-head">
              <Icon name="shield" small />
              <b style={{ fontWeight: "var(--fw-medium)" }}>Choose your protection level</b>
              <span className="st neutral"><span className="sd" />Not set</span>
            </div>
            <span className="t2 pv-text">No device has set a protection level for this account yet. Until one does, your data uses Standard protection.</span>
            <div className="pv-line">
              <button type="button" className="btn sm" disabled={paused} title={paused ? PAUSED_PROTECTION_HINT : undefined} onClick={() => setChoosing(true)}>Choose</button>
              {paused && <span className="t3 small">Paused while your account is scheduled for deletion.</span>}
            </div>
          </>
        ) : (
          <>
            <div className="pv-head">
              <Icon name="shield" small />
              <b style={{ fontWeight: "var(--fw-medium)" }}>{level} protection{confirmedOn}</b>
              <span className="st err"><span className="sd" />Can’t confirm</span>
            </div>
            <span className="t2 pv-text">{REASON_LINES[problemKind!].line}</span>
            <div className="pv-line">
              {kind === "unknownDevice" || kind === "unlisted" ? (
                <button type="button" className="btn sm" onClick={onReviewDevices}>Review devices</button>
              ) : (
                <span className="pv-line"><Icon name="laptop" small />Open Orbyn on a trusted device to fix this.</span>
              )}
              <button type="button" className="ghost sm" onClick={() => setDetails(true)}>Details</button>
            </div>
          </>
        )}
      </div>
      <div className="srow" style={{ opacity: "var(--op-planned)" }}>
        <div className="lab2">
          <b className="pv-choice"><span className="radio" role="radio" aria-checked="false" aria-disabled="true" aria-label="Advanced protection" tabIndex={-1} />Advanced protection</b>
          <small className="planned-text">Advanced is <Planned />. When it ships: switching from Standard deletes Orbyn’s copy of your keys at once; server backups made before the switch may keep a copy until the keys are rotated, which is Planned. An account that starts on Advanced never had one.</small>
        </div>
      </div>
      </div>
      {details && report && kind && <DetailsDialog report={report} kind={kind} confirmed={confirmed} onClose={() => setDetails(false)} onReviewDevices={onReviewDevices} />}
      {askToConfirm && report && (
        <ConfirmDialog
          report={report}
          changedNow={changedNow}
          onClose={() => {
            setConfirmOpen(false);
            setChoosing(false);
          }}
          onNotNow={() => {
            if (report.head) {
              writeSkipped(accountId, report.head.seq);
              setSkipped(report.head.seq);
            }
            setChoosing(false);
            setChangedNow(null);
          }}
          onDone={() => {
            setChangedNow(null);
            setChoosing(false);
            void load(); // the setting is now confirmed here: the card shows it
          }}
          onConflict={() => {
            // Read the chain again, and offer Confirm again only if the new state allows it: after a fork, a rollback or an unknown
            // signer the card says Can't confirm, and if the read fails the error card shows. The stale setting is never signed again.
            void load().then((next) => {
              const kind = next ? kindOf(next) : null;
              if (next && (kind === "confirming" || kind === "unset")) {
                setChoosing(true);
                setChangedNow(next.signer?.name ?? "another device");
              } else {
                setChoosing(false);
                setConfirmOpen(false);
                setChangedNow(null);
              }
            });
          }}
        />
      )}
    </>
  );
}
