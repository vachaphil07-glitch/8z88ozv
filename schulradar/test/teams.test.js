'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractAssignments, toItems, isAssignmentApi } = require('../src/main/connectors/teams');

test('Graph-Antwort mit eingebetteten Abgaben und Klassen', () => {
  const assignments = {
    value: [
      {
        '@odata.type': '#microsoft.graph.educationAssignment',
        id: 'a1',
        classId: 'c1',
        displayName: 'Projektdokumentation Kapitel 2',
        dueDateTime: '2026-09-23T21:59:00Z',
        status: 'assigned',
        instructions: { content: '<p>Bitte als <b>PDF</b> abgeben.</p>', contentType: 'html' },
        webUrl: 'https://teams.microsoft.com/l/entity/66aeee93/x',
        submissions: [{ id: 's1', status: 'working', submittedDateTime: null, recipient: { userId: 'u' } }]
      },
      {
        id: 'a2',
        classId: 'c2',
        displayName: 'Präsentation Datenbanken',
        dueDateTime: '2026-09-21T21:59:00Z',
        status: 'assigned',
        submissions: [{ id: 's2', status: 'submitted', submittedDateTime: '2026-09-20T18:00:00Z', recipient: {} }]
      },
      { id: 'a3', classId: 'c1', displayName: 'Entwurf', dueDateTime: '2026-10-01T10:00:00Z', status: 'draft' },
      {
        id: 'a4',
        classId: 'c1',
        displayName: 'Laborprotokoll',
        dueDateTime: '2026-09-18T21:59:00Z',
        submissions: [{ id: 's4', status: 'returned', returnedDateTime: '2026-09-19T10:00:00Z', recipient: {} }]
      }
    ]
  };
  const classes = {
    value: [
      { id: 'c1', displayName: '4AHIT SEW', classCode: 'SEW', externalName: '' },
      { id: 'c2', displayName: '4AHIT DBI', mailNickname: 'dbi', description: '' }
    ]
  };
  const parsed = extractAssignments([assignments, classes]);
  assert.equal(parsed.assignments.length, 4);
  assert.equal(parsed.classes.get('c1'), '4AHIT SEW');
  const items = toItems(parsed, { from: Date.parse('2026-09-01T00:00:00Z') });
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(items.length, 3, 'Entwürfe werden ausgelassen');
  assert.equal(byId['teams:a1'].status, 'open');
  assert.equal(byId['teams:a1'].course, '4AHIT SEW');
  assert.equal(byId['teams:a1'].description, 'Bitte als PDF abgeben.');
  assert.equal(byId['teams:a1'].due, Date.parse('2026-09-23T21:59:00Z'));
  assert.equal(byId['teams:a2'].status, 'submitted');
  assert.equal(byId['teams:a2'].course, '4AHIT DBI');
  assert.equal(byId['teams:a4'].status, 'graded');
});

test('Abgabestatus aus separater Antwort mit assignmentId', () => {
  const docs = [
    { items: [{ id: 'x1', title: 'Reflexion', dueDate: '2026-09-25T20:00:00Z', className: 'KSN' }] },
    { submissions: [{ assignmentId: 'x1', status: 'submitted', submittedDateTime: '2026-09-24T10:00:00Z' }] }
  ];
  const items = toItems(extractAssignments(docs));
  assert.equal(items.length, 1);
  assert.equal(items[0].status, 'submitted');
  assert.equal(items[0].course, 'KSN');
});

test('Welche Antworten mitgelesen werden', () => {
  const { isCandidate } = require('../src/main/connectors/teams');
  assert.ok(isCandidate('https://teams.cloud.microsoft/api/whatever', 'application/json'));
  assert.ok(isCandidate('https://assignments.onenote.com/api/v1.0/edu/me/assignments', 'text/plain'));
  assert.ok(!isCandidate('https://teams.cloud.microsoft/api/chatsvc/emea/v1/users/ME/conversations', 'application/json'));
  assert.ok(!isCandidate('https://statics.teams.cdn.office.net/app.js', 'application/javascript'));
});

test('Erkennung von Aufgaben-Schnittstellen', () => {
  assert.ok(isAssignmentApi('https://assignments.onenote.com/api/v1.0/edu/me/assignments?$top=20'));
  assert.ok(isAssignmentApi('https://graph.microsoft.com/v1.0/education/me/assignments'));
  assert.ok(!isAssignmentApi('https://statics.teams.cdn.office.net/assignments/main.js'));
  assert.ok(!isAssignmentApi('https://teams.microsoft.com/api/chatsvc/emea/v1/users/ME/conversations'));
});
