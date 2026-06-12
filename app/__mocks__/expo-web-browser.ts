export type WebBrowserOpenOptions = { showInRecents?: boolean };

export const openBrowserAsync = jest.fn(() => Promise.resolve({ type: 'dismiss' }));
