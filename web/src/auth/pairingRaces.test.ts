import { emptySyncState } from "../api/keyStore";
import { describe, expect, it } from "vitest";
import { removeDevice, signOut } from "./flows";
import { ApproverController, DeviceController } from "./pairing";
import { calls, createRig, until } from "./testing/rig";

describe("the trusted device after a cancel", () => {
  it("never reveals or signs once it has been cancelled, wherever the cancel came", async () => {
    const r = await createRig();
    const approver = new ApproverController(r.a.services, r.a.session, r.d.device);
    void approver.start();
    await until(() => approver.getState().phase === "waiting");
    await approver.cancel();
    // The new device joins late; the cancelled approval does not wake up.
    const device = new DeviceController(r.d.services, r.d.session);
    void device.run();
    await new Promise((res) => setTimeout(res, 120));
    expect(approver.getState()).toMatchObject({ phase: "closed", reason: "cancelled" });
    expect(calls(r, "/reveal")).toHaveLength(0);
    expect(calls(r, "/confirm")).toHaveLength(0);
    expect(r.counts.sign).toBe(0);
    device.dispose();
  });

  it("a cancel while confirming stops before the post, and the screen stays closed", async () => {
    const r = await createRig({ slowDevices: 80 });
    const approver = new ApproverController(r.a.services, r.a.session, r.d.device);
    const device = new DeviceController(r.d.services, r.d.session);
    void approver.start();
    void device.run();
    await until(() => approver.getState().phase === "compare");
    void approver.confirm(); // reads the device list, slowly
    await until(() => approver.getState().phase === "confirming");
    await approver.cancel();
    await new Promise((res) => setTimeout(res, 200));
    expect(approver.getState()).toMatchObject({ phase: "closed", reason: "cancelled" });
    expect(calls(r, "/confirm")).toHaveLength(0);
    expect(r.counts.sign).toBe(0);
    device.dispose();
  });

  it("They match twice signs once", async () => {
    const r = await createRig();
    const approver = new ApproverController(r.a.services, r.a.session, r.d.device);
    const device = new DeviceController(r.d.services, r.d.session);
    void approver.start();
    void device.run();
    await until(() => approver.getState().phase === "compare");
    void approver.confirm();
    void approver.confirm();
    await until(() => approver.getState().phase === "finishing");
    expect(r.counts.sign).toBe(1);
    expect(calls(r, "/confirm")).toHaveLength(1);
    device.dispose();
    approver.dispose();
  });

  it("They match does nothing before the digits are shown", async () => {
    const r = await createRig();
    const approver = new ApproverController(r.a.services, r.a.session, r.d.device);
    void approver.start();
    await until(() => approver.getState().phase === "waiting");
    await approver.confirm();
    expect(approver.getState().phase).toBe("waiting");
    expect(calls(r, "/confirm")).toHaveLength(0);
    await approver.cancel();
  });
});

describe("the new device's guards", () => {
  it("They match is ignored unless the digits are showing, and a second tap cannot change what was typed", async () => {
    const r = await createRig();
    const approver = new ApproverController(r.a.services, r.a.session, r.d.device);
    const device = new DeviceController(r.d.services, r.d.session);
    device.confirm("123456"); // nothing to confirm yet
    expect(device.getState().phase).toBe("waiting");
    void approver.start();
    void device.run();
    await until(() => device.getState().phase === "compare");
    device.confirm(); // "They match"
    device.confirm("000000"); // ignored: this device is already finishing
    expect(device.getState().phase).toBe("finishing");
    await until(() => approver.getState().phase === "compare");
    void approver.confirm();
    await until(() => device.getState().phase === "trusted"); // a typed 000000 would have been a mismatch
    expect(r.counts.finish).toBe(1);
    approver.dispose();
  });

  it("a tab that joined must finish even when the server already says trusted", async () => {
    const r = await createRig();
    const approver = new ApproverController(r.a.services, r.a.session, r.d.device);
    const device = new DeviceController(r.d.services, r.d.session);
    void approver.start();
    void device.run();
    await until(() => device.getState().phase === "compare");
    device.confirm();
    // Something else made the server list this device as trusted before this tab finished.
    r.d.device.state = "trusted";
    await new Promise((res) => setTimeout(res, 80));
    expect(device.getState().phase).toBe("finishing");
    expect(r.d.services.tokens.getSession()?.deviceState).toBe("pending");
    await until(() => approver.getState().phase === "compare");
    void approver.confirm();
    await until(() => device.getState().phase === "trusted");
    expect(r.counts.finish).toBe(1); // it ran finishApproval, which pins the approver
    approver.dispose();
  });
});

describe("a second tab of the waiting device", () => {
  for (const repair of [false, true]) {
    it(`never cancels the approval the first tab answers${repair ? " (re-pair)" : ""}`, async () => {
      const r = await createRig({ newDeviceState: repair ? "trusted" : "pending" });
      const approver = new ApproverController(r.a.services, r.a.session, r.d.device);
      void approver.start();
      await until(() => approver.getState().phase === "waiting"); // a re-pair screen opens on an existing approval
      const first = new DeviceController(r.d.services, r.d.session, repair);
      void first.run();
      await until(() => first.getState().phase === "joined" || first.getState().phase === "compare");
      const second = new DeviceController(await r.tabOfD(), r.d.session, repair);
      void second.run();
      await until(() => second.getState().phase === "elsewhere");
      await new Promise((res) => setTimeout(res, 80));
      expect(second.getState().phase).toBe("elsewhere");
      expect(calls(r, "/cancel")).toHaveLength(0);
      // The first tab's approval goes on to the digits.
      await until(() => first.getState().phase === "compare" && approver.getState().phase === "compare");
      first.dispose();
      second.dispose();
      approver.dispose();
    });
  }
});

describe("a failed save stops the step that depended on it", () => {
  it("confirming does not post", async () => {
    const r = await createRig();
    const approver = new ApproverController(r.a.services, r.a.session, r.d.device);
    const device = new DeviceController(r.d.services, r.d.session);
    void approver.start();
    void device.run();
    await until(() => approver.getState().phase === "compare");
    r.fail.save = true;
    await approver.confirm(); // fails at once: nothing to wait for
    expect(calls(r, "/confirm")).toHaveLength(0);
    expect(approver.getState()).toMatchObject({ phase: "closed", reason: "failed" });
    device.dispose();
  });

  it("finishing does not send the digits", async () => {
    const r = await createRig();
    const approver = new ApproverController(r.a.services, r.a.session, r.d.device);
    const device = new DeviceController(r.d.services, r.d.session);
    void approver.start();
    void device.run();
    await until(() => approver.getState().phase === "compare" && device.getState().phase === "compare");
    void approver.confirm();
    await until(() => approver.getState().phase === "finishing");
    r.fail.save = true;
    device.confirm();
    await until(() => device.getState().phase === "closed");
    expect(calls(r, "/code")).toHaveLength(0);
    expect(device.getState()).toMatchObject({ phase: "closed", reason: "failed" });
    approver.dispose();
  });

  it("a signed removal is not sent", async () => {
    const r = await createRig();
    r.fail.save = true;
    await expect(removeDevice(r.a.services, r.a.session, r.d.device)).rejects.toThrow(/quota/);
    expect(r.engine.calls.filter((c) => c.method === "DELETE" && c.path.startsWith("/v1/devices/0"))).toHaveLength(0);
    r.fail.save = false;
    await removeDevice(r.a.services, r.a.session, r.d.device);
    expect(r.engine.calls.filter((c) => c.method === "DELETE" && c.path.startsWith("/v1/devices/0"))).toHaveLength(1);
  });
});

describe("signing out", () => {
  it("forgets the device inside the lock, tells the other tabs, and says if it could not", async () => {
    const r = await createRig();
    await r.a.services.engine.run(r.a.session, (e) => e.verifyDevices({ devices: [], removals: [] }));
    expect(await r.a.keys.loadSnapshot()).not.toBeNull();
    let heard = 0;
    const stop = r.d.services.signedOut.listen(() => heard++);
    await signOut(r.a.services);
    await until(() => heard === 1);
    stop();
    expect(await r.a.keys.loadKeys()).toBeNull();
    expect(await r.a.keys.loadSnapshot()).toBeNull();
    expect(await r.a.keys.loadWrapKey()).toBeNull();

    const broken = await createRig();
    broken.d.keys.clearDevice = async () => {
      throw new Error("blocked");
    };
    await expect(signOut(broken.d.services)).rejects.toThrow(/couldn’t be removed/);
    expect(broken.d.services.tokens.getSession()).toBeNull(); // still signed out here
  });

  it("when an approval completes, both devices forget which zone keys they sent, so the next pass sends them all again", async () => {
    const r = await createRig();
    const sent = { ...emptySyncState(), keysSent: { "list:inbox": "a,d" } };
    await r.a.keys.saveSyncState(sent);
    await r.d.keys.saveSyncState(sent);
    const approver = new ApproverController(r.a.services, r.a.session, r.d.device);
    const device = new DeviceController(r.d.services, r.d.session);
    void approver.start();
    void device.run();
    await until(() => device.getState().phase === "compare");
    device.confirm();
    await until(() => approver.getState().phase === "compare");
    void approver.confirm();
    await until(() => device.getState().phase === "trusted" && approver.getState().phase === "done");
    expect((await r.d.keys.loadSyncState())?.keysSent).toEqual({});
    expect((await r.a.keys.loadSyncState())?.keysSent).toEqual({});
    approver.dispose();
  });
});
