const { getDefaultConfig } = require('expo/metro-config')
const { withUniwindConfig } = require('uniwind/metro') // make sure this import exists
const fs = require('fs')
const path = require('path')

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname)

// bao is a pnpm workspace: Expo auto-detects it and adds <repo>/node_modules to watchFolders.
// Drop watch folders that don't exist (e.g. when apps/mobile is installed standalone with npm).
config.watchFolders = (config.watchFolders ?? []).filter((folder) => fs.existsSync(folder))

// The shared SDK lives in packages/sdk and is linked with `file:`. Watch it, and resolve the
// SDK's package imports from this app's node_modules so @solana/kit exists exactly once.
// Packages keep normal (hierarchical) lookup for their own nested dependencies.
const sdkRoot = path.resolve(__dirname, '../../packages/sdk')
const appEntry = path.join(__dirname, 'index.js')
config.watchFolders.push(sdkRoot)
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')]
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const fromSdk = context.originModulePath.startsWith(sdkRoot + path.sep)
  if (fromSdk && !moduleName.startsWith('.') && !path.isAbsolute(moduleName)) {
    return context.resolveRequest({ ...context, originModulePath: appEntry }, moduleName, platform)
  }
  return context.resolveRequest(context, moduleName, platform)
}

// Apply uniwind modifications before exporting
const uniwindConfig = withUniwindConfig(config, {
  // relative path to your global.css file
  cssEntryFile: './src/global.css',
  // optional: path to typings
  dtsFile: './src/uniwind-types.d.ts',
})

// Cache transforms per project; the machine-wide Metro cache can serve stale transforms from other projects.
uniwindConfig.cacheStores = ({ FileStore }) => [
  new FileStore({ root: path.join(__dirname, 'node_modules', '.cache', 'metro') }),
]

module.exports = uniwindConfig
