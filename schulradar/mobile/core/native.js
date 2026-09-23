'use strict';
// Zugriff auf das eigene Android-Plugin (android/app/src/main/java/at/schulradar/app/SchulradarNativePlugin.java)
const { registerPlugin } = require('@capacitor/core');

const Native = registerPlugin('SchulradarNative');
const SystemBars = registerPlugin('SystemBars');

module.exports = { Native, SystemBars };
