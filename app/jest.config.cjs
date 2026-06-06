'use strict';

/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  globals: {
    'ts-jest': {
      tsconfig: {
        jsx: 'react',
      },
    },
  },
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  passWithNoTests: true,
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/../shared/src/$1',
    '^react-native$': '<rootDir>/__mocks__/react-native.ts',
    '^react-native-mmkv$': '<rootDir>/__mocks__/react-native-mmkv.ts',
    '^@supabase/supabase-js$': '<rootDir>/__mocks__/@supabase/supabase-js.ts',
    '^react-native-reanimated$': '<rootDir>/__mocks__/react-native-reanimated.ts',
    '^react-native-gesture-handler$': '<rootDir>/__mocks__/react-native-gesture-handler.ts',
    '^react-native-pressable-scale$': '<rootDir>/__mocks__/react-native-pressable-scale.ts',
    '^react-native-svg$': '<rootDir>/__mocks__/react-native-svg.ts',
    '^react-native-safe-area-context$': '<rootDir>/__mocks__/react-native-safe-area-context.ts',
    '^expo-navigation-bar$': '<rootDir>/__mocks__/expo-navigation-bar.ts',
    '^react-native-webview$': '<rootDir>/__mocks__/react-native-webview.tsx',
  },
};
