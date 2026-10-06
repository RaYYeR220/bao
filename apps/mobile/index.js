// index.js — the crypto polyfill must load before anything touches @solana/kit.
import './polyfill'
import { registerWidgetTaskHandler } from 'react-native-android-widget'

import { widgetTaskHandler } from './src/widget/task-handler'
import 'expo-router/entry'

registerWidgetTaskHandler(widgetTaskHandler)
