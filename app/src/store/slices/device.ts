import type { StateCreator } from 'zustand';

export interface DeviceSlice {
  deviceId: string | null;
  notificationsEnabled: boolean;
  setDeviceRegistration: (r: { deviceId: string }) => void;
  setNotificationsEnabled: (v: boolean) => void;
}

export const createDeviceSlice: StateCreator<DeviceSlice> = (set) => ({
  deviceId: null,
  notificationsEnabled: false,
  // The FCM token's authoritative copy lives in MMKV (TOKEN_KEY); the store
  // only needs the deviceId, so we deliberately drop fcmToken here.
  setDeviceRegistration: ({ deviceId }) => set({ deviceId }),
  setNotificationsEnabled: (v) => set({ notificationsEnabled: v }),
});
