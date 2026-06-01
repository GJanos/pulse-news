import type { StateCreator } from 'zustand';

export interface DeviceSlice {
  deviceId: string | null;
  fcmToken: string | null;
  notificationsEnabled: boolean;
  setDeviceRegistration: (r: { deviceId: string; fcmToken: string }) => void;
  setNotificationsEnabled: (v: boolean) => void;
}

export const createDeviceSlice: StateCreator<DeviceSlice> = (set) => ({
  deviceId: null,
  fcmToken: null,
  notificationsEnabled: false,
  setDeviceRegistration: ({ deviceId, fcmToken }) => set({ deviceId, fcmToken }),
  setNotificationsEnabled: (v) => set({ notificationsEnabled: v }),
});
