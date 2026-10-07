// Expo prefixes every intent-filter action in app.json with "android.intent.action.", which turns
// "android.nfc.action.NDEF_DISCOVERED" into an action Android never sends. Restore the real name so
// tapping an NFC tag written by the Share screen opens the packet directly.
const { withAndroidManifest } = require('expo/config-plugins')

const WRONG_PREFIX = 'android.intent.action.android.nfc.action.'
const RIGHT_PREFIX = 'android.nfc.action.'

module.exports = function withNfcIntent(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0]
    for (const activity of app?.activity ?? []) {
      for (const filter of activity['intent-filter'] ?? []) {
        for (const action of filter.action ?? []) {
          const name = action.$['android:name']
          if (name.startsWith(WRONG_PREFIX)) {
            action.$['android:name'] = RIGHT_PREFIX + name.slice(WRONG_PREFIX.length)
          }
        }
      }
    }
    return cfg
  })
}
