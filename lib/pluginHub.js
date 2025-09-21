// lib/pluginHub.js
let _plugins = [];
function setPlugins(list) {
  _plugins = Array.isArray(list) ? list : [];
}
function getPlugins() {
  return _plugins;
}
module.exports = { setPlugins, getPlugins };