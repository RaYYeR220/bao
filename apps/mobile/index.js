// index.js: the crypto polyfill loads first, before anything else (and so before @solana/kit
// or the Mobile Wallet Adapter): crypto.getRandomValues, crypto.subtle and Buffer.
import './polyfill'
import { registerWidgetTaskHandler } from 'react-native-android-widget'

import { widgetTaskHandler } from './src/widget/task-handler'
import 'expo-router/entry'

registerWidgetTaskHandler(widgetTaskHandler)
