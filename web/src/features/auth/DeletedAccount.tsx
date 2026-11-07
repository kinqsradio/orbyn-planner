import { useState } from "react";
import { useNow } from "../../app/clock";
import { deletedAccount, type DeletedAccount } from "../../auth/deletedAccount";
import { deletionDay } from "../../auth/deletionNotice";
import type { AuthServices } from "../../auth/services";
import { forgetProtectionNotice } from "../../auth/protectionNotice";
import { Icon } from "../../components/Icon";
import { closePlanner, plannerFor, removeAccountPlanner } from "../../store/planners";
import { exportJson } from "../export/exportJson";
import { saveFile } from "../export/save";

/** "2.4 MB": the size the browser saved, in the units the designs use. */
export function fileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

const EXPORT_FAILED = "Couldn’t export your data. Nothing was removed from this browser.";
const REMOVE_FAILED = "Couldn’t remove this browser’s copy. Try again, or clear this site’s data in your browser settings.";

/**
 * Shown over everything once the engine has said the account was deleted. The copy on this browser is now the only one, so it is not
 * removed until the person chooses: export it first, or remove it. Removing deletes for good, so there is no second confirmation.
 */
export function DeletedAccountScreen({ account, services, onLeave }: { account: DeletedAccount; services: AuthServices; onLeave: (to: "signup" | "signin") => void }) {
  const now = useNow();
  const [working, setWorking] = useState(false);
  const day = deletionDay(account.deletedAt);
  const who = `${account.email} was deleted on ${day}`;

  const exportCopy = async () => {
    if (working) return;
    setWorking(true);
    try {
      const store = plannerFor(account.accountId);
      await store.ready;
      const stamp = new Date(now.getTime()).toISOString().slice(0, 10);
      const name = `orbyn-planner-${stamp}.json`;
      const body = exportJson(store.getState(), new Date(now.getTime()).toISOString());
      // The person may close the save dialog (desktop): then nothing was exported and nothing changes.
      if (await saveFile(name, "application/json", body)) deletedAccount.update({ phase: "exported", file: { name, size: new Blob([body]).size } });
    } catch {
      deletedAccount.update({ phase: "export-failed" });
    } finally {
      setWorking(false);
    }
  };

  const removeCopy = async () => {
    if (working) return;
    setWorking(true);
    deletedAccount.update({ phase: "removing" });
    try {
      await removeAccountPlanner(account.accountId);
      await services.engine.forget();
      forgetProtectionNotice(account.accountId);
      deletedAccount.update({ phase: "final" });
    } catch {
      deletedAccount.update({ phase: "remove-failed" });
    } finally {
      setWorking(false);
    }
  };

  const leave = (to: "signup" | "signin") => {
    // A browser that held the account in memory only lets go of what the tab still has.
    if (!account.hadCopy) {
      closePlanner(account.accountId);
      void services.engine.forget().catch(() => undefined);
    }
    onLeave(to);
  };

  const note = <span className="t4 small">Removing it deletes this browser’s copy for good.</span>;
  const copyRemoves = (
    <button type="button" className="ghost lg red" disabled={working} onClick={() => void removeCopy()}>Remove it now</button>
  );
  let body;
  switch (account.phase) {
    case "choose":
      body = (
        <>
          <span className="t2">{who}. Its data on Orbyn’s servers is gone and can’t be restored.</span>
          <span className="t3 small">A copy is still on this browser, and it’s the only one left. Export it first if you want to keep anything. Nothing else opens until you choose.</span>
          <div className="pv-stack">
            <button type="button" className="btn lg" data-autofocus disabled={working} onClick={() => void exportCopy()}><Icon name="download" small />Export what’s on this browser</button>
            {copyRemoves}
          </div>
          {note}
        </>
      );
      break;
    case "exported":
      body = (
        <>
          <span className="t2 line"><span className="pv-ok"><Icon name="check2" small /></span>Downloaded {account.file?.name} · {fileSize(account.file?.size ?? 0)}</span>
          <span className="t3 small">The copy on this browser is still here until you remove it.</span>
          <div className="pv-stack">
            <button type="button" className="btn lg" data-autofocus disabled={working} onClick={() => void removeCopy()}>Remove it now</button>
            <button type="button" className="ghost lg" disabled={working} onClick={() => void exportCopy()}><Icon name="download" small />Export again</button>
          </div>
          {note}
        </>
      );
      break;
    case "export-failed":
      body = (
        <>
          <span className="t2 line" role="alert"><span className="pv-red"><Icon name="alert" small /></span>{EXPORT_FAILED}</span>
          <span className="t3 small">The copy on this browser is the only one left.</span>
          <div className="pv-stack">
            <button type="button" className="btn lg" data-autofocus disabled={working} onClick={() => void exportCopy()}>Try again</button>
            <button type="button" className="ghost lg red" disabled={working} onClick={() => void removeCopy()}>Remove it anyway</button>
          </div>
          {note}
        </>
      );
      break;
    case "removing":
      body = (
        <>
          <span className="t2">{who}. Its data can’t be restored.</span>
          <span className="t3 small line" role="status"><span className="spin" aria-hidden="true" />Removing its copy from this browser</span>
          <div className="prog blue" aria-hidden="true"><i style={{ width: "55%" }} /></div>
          <span className="t4 small">This takes a moment. Nothing else opens until it’s done.</span>
        </>
      );
      break;
    case "remove-failed":
      body = (
        <>
          <span className="t2 line" role="alert"><span className="pv-red"><Icon name="alert" small /></span>{REMOVE_FAILED}</span>
          <div className="pv-stack">
            <button type="button" className="btn lg" data-autofocus disabled={working} onClick={() => void removeCopy()}>Try again</button>
          </div>
          {note}
        </>
      );
      break;
    case "final":
      body = (
        <>
          <span className="t2">
            {account.hadCopy ? `${who}, after its 7 days ended. Its data can’t be restored.` : `${who}. Its data on Orbyn’s servers is gone and can’t be restored.`}
          </span>
          <span className="t3 small">{account.hadCopy ? "Orbyn removed its copy from this browser." : "This browser had no copy to remove."}</span>
          <div className="pv-row">
            <button type="button" className="btn" data-autofocus onClick={() => leave("signup")}>Create a new account</button>
            <button type="button" className="ghost" onClick={() => leave("signin")}>Sign in with another account</button>
          </div>
        </>
      );
      break;
  }
  return (
    <main className="public-page" id="content" tabIndex={-1}>
      <div className="authcard deleted-card" role="group" aria-label="This account was deleted">
        <h1 className="keys-title">This account was deleted</h1>
        {body}
      </div>
    </main>
  );
}
