const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const reprocessor = require('../reprocess.js');

const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
// Exercise the actual UI handlers with state and rendering isolated from the DOM.
const handlers = source.slice(source.indexOf('  function reparseSessionAnswers()'), source.indexOf('  async function startEvaluation()'));
function controls(state) {
  return new Function('state', 'window', 'renderApp', handlers + '\nreturn { reparseSessionAnswers, undoReparse };')(
    state, { ResultReprocessor: reprocessor }, () => {});
}
function run() {
  return { metadata: { config: { mode: 'sequential' } }, psychometrics: { itemRatings: { 1: 5 } }, rawResponses: { 1: '4' } };
}

test('Reparse answers updates the selected run and Undo restores the original session', () => {
  const original = [run(), run()];
  const state = { sessionResults: original, results: original[1], isRunning: false };
  const ui = controls(state);
  ui.reparseSessionAnswers();
  assert.strictEqual(state.results, state.sessionResults[1]);
  assert.equal(state.results.psychometrics.itemRatings[1], 4);
  assert.match(state.progressStatus, /Reparsed 2 answers; 2 ratings changed/);
  ui.undoReparse();
  assert.strictEqual(state.sessionResults, original);
  assert.strictEqual(state.results, original[1]);
  assert.equal(state.results.psychometrics.itemRatings[1], 5);
  assert.equal(state.reparseUndo, null);
});

test('UI refuses reparsing during evaluation and preserves the session on failure', () => {
  const original = [run()];
  const state = { sessionResults: original, results: original[0], isRunning: true };
  const ui = controls(state);
  ui.reparseSessionAnswers();
  assert.strictEqual(state.sessionResults, original);
  state.isRunning = false;
  state.sessionResults.push({});
  ui.reparseSessionAnswers();
  assert.strictEqual(state.sessionResults, original);
  assert.equal(state.results.psychometrics.itemRatings[1], 5);
  assert.match(state.errorMessage, /execution mode/);
});
