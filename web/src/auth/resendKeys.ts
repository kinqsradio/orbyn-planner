import type { AuthServices } from "./services";

/**
 * Called on both devices when an approval completes. The zone keys this device sent were recorded against the set of
 * trusted devices; a device that was approved again (it lost its saved state, so it holds no keys) is in that set
 * already, so nothing would be sent to it. Forgetting what was sent makes the next sync pass send every zone's keys to
 * everyone again, which the server takes idempotently. It also ends the "reset" state: this device has been approved again. Best effort: sync catches up either way.
 */
export async function resendKeysAfterApproval(services: AuthServices): Promise<void> {
  try {
    await services.engine.exclusive(async () => {
      const state = await services.keys.loadSyncState();
      if (state && (state.reset || Object.keys(state.keysSent).length > 0)) await services.keys.saveSyncState({ ...state, keysSent: {}, reset: false });
    });
  } catch {
    // The keys go out when the set of devices next changes.
  }
}
