// Keeps native builds stable on machines with little free memory and a flaky network:
// fewer workers, in-process Kotlin, and generous HTTP retries for dependency downloads.
const { withGradleProperties } = require('expo/config-plugins')

const PROPS = {
  'org.gradle.parallel': 'false',
  'org.gradle.workers.max': '2',
  'kotlin.compiler.execution.strategy': 'in-process',
  'systemProp.org.gradle.internal.repository.max.retries': '10',
  'systemProp.org.gradle.internal.repository.initial.backoff': '1000',
  'systemProp.org.gradle.internal.http.connectionTimeout': '120000',
  'systemProp.org.gradle.internal.http.socketTimeout': '120000',
}

module.exports = function withGradleTuning(config) {
  return withGradleProperties(config, (cfg) => {
    for (const [key, value] of Object.entries(PROPS)) {
      cfg.modResults = cfg.modResults.filter((p) => !(p.type === 'property' && p.key === key))
      cfg.modResults.push({ type: 'property', key, value })
    }
    return cfg
  })
}
