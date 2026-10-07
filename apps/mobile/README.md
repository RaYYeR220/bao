# Bao for Android

The Bao app: drop red packets of SKR, shake to grab a share, and watch the program refuse a second grab from the
same phone. Expo SDK 57, React Native 0.86, Mobile Wallet Adapter (`@wallet-ui/react-native-kit`), `@solana/kit`,
Skia and Reanimated. It runs on Solana **devnet**.

## Run it

```bash
npm install
npm run android        # expo run:android: builds the dev client and installs it on a device or emulator
```

You need the Android SDK, a device or emulator, and a wallet that speaks Mobile Wallet Adapter (on a Seeker, the
built-in Seed Vault wallet). The app talks to the API at `https://getbao.vercel.app`; when that is unreachable it
reads the feed, packets and history straight from the chain.

A signed release build reads its upload key from the environment (`BAO_KEYSTORE_PATH`, `BAO_KEYSTORE_PASSWORD`,
`BAO_KEY_ALIAS`), see `plugins/with-release-signing.js`:

```bash
npx expo prebuild -p android
cd android && ./gradlew :app:assembleRelease
```

## Layout

| Path | What |
|---|---|
| `src/routes` | screens (expo-router): feed, grab, send, share, circles, my box, Seeker, scan, onboarding |
| `src/features/bao/data-access` | the Mobile Wallet Adapter session, transaction builders from `@bao/sdk`, the API client and the chain reader |
| `src/features/bao/links.ts` | one parser for deep links, QR codes, NFC tags and push payloads |
| `src/features/bao/ui` | Bao's own components |
| `src/ui` | the Lacquer Box kit: envelope, type, motion, haptics and sound |
| `src/widget` | the home-screen widget |
| `plugins` | config plugins: Gradle tuning and release signing |
