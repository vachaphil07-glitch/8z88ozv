'use strict';
const webuntis = require('./webuntis');
const teams = require('./teams');
const letto = require('./letto');
const eduvidual = require('./eduvidual');

const connectors = { webuntis, teams, letto, eduvidual };

module.exports = { connectors, list: Object.values(connectors) };
