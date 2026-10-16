// Expo config plugin: signs Android release builds with an upload keystore kept OUTSIDE the repo.
//
// The keystore details are read at build time from a .properties file:
//   1. the path in the POCKETVAULT_SIGNING_PROPERTIES environment variable, or
//   2. ../keystores/pocketvault-signing.properties (next to the project folder).
//
// Expected keys: storeFile, storePassword, keyAlias, keyPassword.
// If the file is missing, release builds fall back to the debug key (and print a warning),
// so the project still builds on other machines.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// pocketvault-release-signing';

const SIGNING_CONFIG = `
        ${MARKER}
        release {
            def signingPropsPath = System.getenv('POCKETVAULT_SIGNING_PROPERTIES') ?: new File(rootDir, '../../keystores/pocketvault-signing.properties').canonicalPath
            def signingPropsFile = new File(signingPropsPath)
            if (signingPropsFile.exists()) {
                def signingProps = new Properties()
                signingPropsFile.withInputStream { signingProps.load(it) }
                storeFile file(signingProps['storeFile'])
                storePassword signingProps['storePassword']
                keyAlias signingProps['keyAlias']
                keyPassword signingProps['keyPassword']
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;

    // 1. Add a "release" signing config after the debug one.
    gradle = gradle.replace(
      /(signingConfigs\s*\{\s*debug\s*\{[^}]*\})/,
      `$1${SIGNING_CONFIG}`,
    );

    // 2. Use it for release builds when the keystore is configured.
    gradle = gradle.replace(
      /(release\s*\{[^}]*?)signingConfig signingConfigs\.debug/,
      `$1signingConfig signingConfigs.release.storeFile != null ? signingConfigs.release : signingConfigs.debug
            if (signingConfigs.release.storeFile == null) {
                logger.warn('PocketVault: release keystore not found, signing release with the DEBUG key.')
            }`,
    );

    if (!gradle.includes(MARKER)) {
      throw new Error('withReleaseSigning: could not find the signingConfigs block in app/build.gradle');
    }

    // 3. Optional per-ABI APKs for sharing (smaller downloads): pass -Ppocketvault.splitApks=true.
    //    Play Store uploads use the .aab instead, which splits per device automatically.
    gradle = gradle.replace(
      /(\n\s*signingConfigs\s*\{)/,
      `
    splits {
        abi {
            enable project.hasProperty('pocketvault.splitApks')
            reset()
            include 'arm64-v8a', 'armeabi-v7a', 'x86_64'
            universalApk true
        }
    }$1`,
    );
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
