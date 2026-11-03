// El núcleo SNMP/outbox se comparte con la versión Android nativa (../mobile/src/core).
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../mobile/src/core')];
if (!config.resolver.sourceExts.includes('mjs')) {
  config.resolver.sourceExts.push('mjs');
}
module.exports = config;
