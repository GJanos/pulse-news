// eslint-disable-next-line @typescript-eslint/no-var-requires
const { applyReleaseSigning } = require('../../../plugins/withReleaseSigning') as {
  applyReleaseSigning: (gradle: string) => string;
};

// Trimmed copy of the android/app/build.gradle that `expo prebuild` emits.
const STOCK_GRADLE = `
android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;

describe('applyReleaseSigning', () => {
  it('adds an env-driven release signing config', () => {
    const out = applyReleaseSigning(STOCK_GRADLE);
    expect(out).toMatch(/release \{ \/\/ pulse:release-signing/);
    expect(out).toContain("storeFile file(System.getenv('PULSE_UPLOAD_STORE_FILE'))");
  });

  it('points the release build type at the release config, leaving debug on the debug key', () => {
    const out = applyReleaseSigning(STOCK_GRADLE);
    const buildTypes = out.slice(out.indexOf('buildTypes'));
    const debugBlock = buildTypes.slice(0, buildTypes.indexOf('release {'));
    const releaseBlock = buildTypes.slice(buildTypes.indexOf('release {'));
    expect(debugBlock).toContain('signingConfig signingConfigs.debug');
    expect(releaseBlock).toContain('signingConfig signingConfigs.release');
    expect(releaseBlock).not.toContain('signingConfig signingConfigs.debug');
  });

  it('is idempotent across repeated prebuilds', () => {
    const once = applyReleaseSigning(STOCK_GRADLE);
    expect(applyReleaseSigning(once)).toBe(once);
  });

  it('throws instead of silently shipping debug-signed when the template changes', () => {
    expect(() => applyReleaseSigning('android {}')).toThrow(/signingConfigs\.debug/);
  });
});
