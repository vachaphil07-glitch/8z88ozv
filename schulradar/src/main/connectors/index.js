'use strict';
const webuntis = require('./webuntis');
const teams = require('./teams');
const letto = require('./letto');
const eduvidual = require('./eduvidual');
const lms = require('./lms');
const gcal = require('./gcal');
const gtasks = require('./gtasks');

const connectors = { webuntis, teams, letto, eduvidual, lms, gcal, gtasks };

module.exports = { connectors, list: Object.values(connectors) };
