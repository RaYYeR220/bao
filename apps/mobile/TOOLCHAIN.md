# apps/mobile toolchain spike (Android, Expo SDK 57 + MWA)

**Result: GO.** A dev build of the `expo-kit-wallet` template ran on the emulator and connected to fakewallet over MWA. It signed and sent a devnet memo and rendered the signature in the UI. The signature is finalized on devnet:

- `vzRVGfMLRzXU6vZgaS1bjyNJdRDcKHF6ozfKCz14VJ641s5Qv1R7FndMknWfUiqdzCVSGsXADZh3EWLW2wbJ6PE`, sent from the spike card with status "finalized" in the UI. Explorer: https://explorer.solana.com/tx/vzRVGfMLRzXU6vZgaS1bjyNJdRDcKHF6ozfKCz14VJ641s5Qv1R7FndMknWfUiqdzCVSGsXADZh3EWLW2wbJ6PE?cluster=devnet
- `5UAJaiCKDre9SYcaNMEwPov6sUwWXhTmsHcMpzFFB4zRHMSetMkob9e44roDzF1FDjn3PVnu5FHFAT6kq24kkFsw`, sent from the template's own "Sign and Send Transaction" card. It is also finalized.

Screenshots are in `spike-shots/` (throwaway).

## Versions that worked

| Thing | Version |
|---|---|
| solana-mobile CLI | 0.5.0 (`npx -y solana-mobile@latest`) |
| template | `expo-kit-wallet` (gh:solana-mobile/templates/mobile/expo-kit-wallet) |
| expo | 57.0.26 (template range `~57.0.6`) |
| react-native / react | 0.86.2 / 19.2.3. Expo recommends RN 0.86.3; 0.86.2 works |
| expo-router / expo-dev-client | 57.0.24 / 57.0.19 |
| @wallet-ui/react-native-kit (+ @wallet-ui/core) | 4.3.0 |
| @solana/kit | **7.1.1, pinned exact**. The template had `^7.0.0`, which already resolved to 7.1.1 with a single deduped copy |
| @solana/kit-plugin-rpc | 0.13.0 |
| @solana-program/memo | 0.12.0 |
| @solana-mobile/mobile-wallet-adapter-protocol | 2.3.0 |
| @solana-mobile/mobile-wallet-adapter-protocol-kit | 0.4.0 |
| react-native-quick-crypto / nitro-modules | 1.1.7 / 0.36.5 (libsodium disabled) |
| react-native-mmkv / quick-base64 | 4.3.2 / 3.0.1 |
| reanimated / worklets | 4.5.5 / 0.10.1 |
| heroui-native / uniwind / tailwindcss | 1.0.10 / 1.12.2 / ~4.1 |
| Gradle wrapper | 9.3.1 |
| AGP / Kotlin | 8.12.0 / 2.1.20 (from RN `libs.versions.toml`) |
| compileSdk / targetSdk / minSdk / buildTools | 36 / 36 / 24 / 36.0.0 |
| NDK / CMake | 27.1.12297006 (auto-installed by Gradle) / 3.22.1 |
| JDK | 21.0.11 (Android Studio JBR) |
| Node / npm | 24.13.0 / 11.6.2 |
| Wallet | fakewallet from `@solana-mobile/wallet-adapter-mobile@2.3.0` (CLI APK catalog) |
| Emulator | AVD `clockin_pixel`: Android 35, google_apis x86_64, 2 GB RAM, 4 cores; only the x86_64 ABI is built |

## Commands that worked (rerun from scratch)

```bash
cd bao/apps
npx -y solana-mobile@latest doctor
npx -y solana-mobile@latest emu start clockin_pixel --tune        # boots, disables animations/lockscreen etc.
npx -y solana-mobile@latest create mobile --template expo-kit-wallet --pm npm --skip-git --skip-install
cd mobile
npm install --no-audit --no-fund                                    # ~15 min here (slow network)
npm i @solana/kit@7.1.1 --save-exact --no-audit --no-fund
npx -y solana-mobile@latest device install fakewallet               # no lock-screen PIN needed
npx expo prebuild -p android     # or let `expo run:android` do it; then apply the gradle.properties block below
npx expo run:android             # builds x86_64 only, installs, starts Metro on :8081
adb reverse tcp:8081 tcp:8081
adb shell am start -a android.intent.action.VIEW \
  -d "exp+mobile://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" com.anonymous.mobile
```

In fakewallet, tap **GENERATE** once to create a seed. That gives a stable account (`HhnKcTMmaPzc1XnhB6rCCJTSqEdggdC6BLvYQNig5n46` here). The default "Ephemeral" mode creates a new keypair for every connection. Fund the account with `solana transfer <addr> 0.5 -u devnet --allow-unfunded-recipient`.

Click path in the app:

1. Wallet tab → **Connect Wallet**. In fakewallet, tap **AUTHORIZE**.
2. Tools → Wallet actions → **Send devnet memo**. In fakewallet, tap **AUTHORIZE**, then **SEND TRANSACTION TO CLUSTER**.

When the emulator wasn't starved, the whole sign/send round trip took about 17 s.

## Build time

- `npm install`: about 15 min. The CLI's own install (`--silent`) ran 27 min and then failed with no visible reason, so use `--skip-install`.
- First native build (cold `~/.gradle`): about 55 min in total. That covers three runs that failed on the network or on memory, plus a successful `assembleDebug` of **33 min**. The host had only about 1 GB of RAM free throughout.
- Incremental `expo run:android` after that: 5 min 37 s. First Metro bundle: 288 s (2916 modules). Reloads after that took under 1 s.

## Problems and fixes

1. **The CLI's `create` deleted `apps/mobile` when its npm install failed.** The fix was `--skip-install` and then a plain `npm install`.
2. **`expo run:android --device emulator-5554` gave "Could not find device".** `--device` takes the AVD name. With only one device running, leave the flag out.
3. **Gradle downloads failed intermittently.** The errors were "Plugin org.jetbrains.kotlin.jvm 2.1.20 not found" and "Remote host terminated the handshake" from dl.google.com. The cause was a flaky network, not the build config. The fix was to retry, with the HTTP retry/timeout `systemProp`s below.
4. **Gradle worker JVMs died** with "insufficient memory… paging file is too small (DOS 1455)". The host's commit charge was exhausted. The fix was the low-memory block below and stopping stale Gradle/Kotlin daemons (`gradlew --stop`).
5. **The emulator was CPU/RAM-starved.** Symptoms: ANR dialogs ("Fake Wallet / system isn't responding", answer with Wait), and the app killed by "failed to complete startup". The fix was to retry after the host freed up. Consider giving the AVD 4 GB RAM.
6. **MWA client timeout and blockhash lifetime:**
   - The Android MWA client times out each request after **90 s** (`TimeoutException: Timed out waiting for response with id=2`).
   - The template fetches its blockhash *before* opening the wallet session. With a slow wallet hand-off that cost more than 60 s, devnet returned `BlockhashNotFound`.
   - The fix is the spike card `src/features/tools/tools-feature-spike-send.tsx`. It uses `transact()`, reauthorizes, then fetches `getLatestBlockhash({commitment:'confirmed'})` *inside* the session, then calls `signAndSendTransactions({ transactions:[message], minContextSlot })`, then polls `getSignatureStatuses`.
   - **Use this pattern in the main app.**
7. **Reauth failed ("authorization request failed") after a raw `transact` authorize.** The wallet issues a new `auth_token` on reauthorize, so the cached one goes stale. The fix: fall back to a fresh `authorize`, and persist the new token with `wallet.store.persist({...cached, authToken})`.
8. **Emulator DNS/connect to api.devnet.solana.com failed transiently.** RPC polling now retries on transient errors.
9. **The template's identity URI used the `mobile://` scheme.** It was changed to `{ name: 'Bao Spike', uri: 'https://example.com' }` in `app-providers.tsx`. Use a real https domain in the main app.

## Notes for the main app build

- **Polyfill order:** `index.js` imports `./polyfill` first, which calls `install()` from `react-native-quick-crypto`, and only then imports `expo-router/entry`. Keep that order. `@solana/kit` needs WebCrypto Ed25519 from quick-crypto.
- **Metro in the pnpm workspace:** Expo auto-detects `bao/pnpm-workspace.yaml` and adds `bao/node_modules` to `watchFolders`. That folder doesn't exist yet, so `metro.config.js` filters out missing folders.
  - The template already pins a per-project Metro `FileStore` cache.
  - Uniwind wraps the config (`cssEntryFile: ./src/global.css`).
  - Edits did not hot-reload automatically here; relaunching via the deep link picked them up.
  - The `@noble/hashes/crypto.js` "not listed in exports" WARN is harmless.
- **pnpm vs npm:** the repo `.npmrc` has `node-linker=hoisted`, so npm prints "Unknown project config" warnings. The spike used npm standalone. Under pnpm-hoisted, `bao/node_modules` will exist; re-check autolinking and Metro.
- **Gradle:** `android/` is generated by prebuild, so move these settings into a config plugin or `expo-build-properties` before relying on them. Spike block appended to `android/gradle.properties`:
  ```properties
  org.gradle.parallel=false
  org.gradle.workers.max=2
  kotlin.compiler.execution.strategy=in-process
  systemProp.org.gradle.internal.repository.max.retries=10
  systemProp.org.gradle.internal.repository.initial.backoff=1000
  systemProp.org.gradle.internal.http.connectionTimeout=120000
  systemProp.org.gradle.internal.http.socketTimeout=120000
  ```
- **Driving the UI from adb:** use `MSYS_NO_PATHCONV=1` in Git Bash, otherwise `/sdcard/...` gets rewritten. Positions of fakewallet's buttons:
  - Sign screen: AUTHORIZE ≈ (208, 668).
  - Sending screen: SEND TRANSACTION TO CLUSTER ≈ (540, 900).
  - Authorize-dapp screen: AUTHORIZE ≈ (208, 1013).
