'use strict';
const webuntis = require('./webuntis');
const teams = require('./teams');
const letto = require('./letto');
const eduvidual = require('./eduvidual');
const lms = require('./lms');

const connectors = { webuntis, teams, letto, eduvidual, lms };

module.exports = { connectors, list: Object.values(connectors) };
