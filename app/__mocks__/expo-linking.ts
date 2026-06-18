export const getInitialURL = jest.fn(() => Promise.resolve<string | null>(null));
export const addEventListener = jest.fn(() => ({ remove: jest.fn() }));
