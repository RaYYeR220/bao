// polyfill.js: installs global.crypto (getRandomValues, subtle) and global.Buffer from
// react-native-quick-crypto. index.js imports this before any other module.
import { install } from 'react-native-quick-crypto'

install()
