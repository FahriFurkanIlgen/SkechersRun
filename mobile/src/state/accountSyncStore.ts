import { create } from 'zustand';

/**
 * Progress of loading the signed-in account's data onto this device
 * (profileActions.reconcileAfterSignIn). `dataVersion` changes whenever
 * activities were added from the server, so lists can reload.
 */
interface AccountSyncState {
  busy: boolean;
  message: string | null;
  dataVersion: number;
  start: (message: string) => void;
  update: (message: string) => void;
  finish: () => void;
  bumpData: () => void;
}

export const useAccountSync = create<AccountSyncState>((set) => ({
  busy: false,
  message: null,
  dataVersion: 0,
  start: (message) => set({ busy: true, message }),
  update: (message) => set((s) => (s.busy ? { message } : {})),
  finish: () => set({ busy: false, message: null }),
  bumpData: () => set((s) => ({ dataVersion: s.dataVersion + 1 })),
}));
