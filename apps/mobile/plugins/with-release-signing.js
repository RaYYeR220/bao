// Signs release builds with the upload key when BAO_KEYSTORE_PATH is set in the environment.
// The keystore and its passwords stay outside the repo and are read by Gradle at build time,
// so prebuild never writes a secret into android/. Without the variables, release falls back
// to the debug key (fine for local testing, never for a published APK).
const { withAppBuildGradle } = require('expo/config-plugins')

const RELEASE_CONFIG = `
        release {
            if (System.getenv('BAO_KEYSTORE_PATH')) {
                storeFile file(System.getenv('BAO_KEYSTORE_PATH'))
                storePassword System.getenv('BAO_KEYSTORE_PASSWORD')
                keyAlias System.getenv('BAO_KEY_ALIAS')
                keyPassword System.getenv('BAO_KEY_PASSWORD') ?: System.getenv('BAO_KEYSTORE_PASSWORD')
            }
        }`

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents
    if (gradle.includes("System.getenv('BAO_KEYSTORE_PATH')")) return cfg

    // add the release signing config next to the debug one
    gradle = gradle.replace(
      /(signingConfigs\s*\{\s*debug\s*\{[^}]*\})/,
      `$1${RELEASE_CONFIG}`,
    )
    // point the release build type at it when the keystore is configured
    gradle = gradle.replace(
      /(release\s*\{[^{}]*?)signingConfig signingConfigs\.debug/,
      "$1signingConfig System.getenv('BAO_KEYSTORE_PATH') ? signingConfigs.release : signingConfigs.debug",
    )
    if (!gradle.includes('signingConfigs.release')) {
      throw new Error('with-release-signing: could not patch android/app/build.gradle')
    }
    cfg.modResults.contents = gradle
    return cfg
  })
}
