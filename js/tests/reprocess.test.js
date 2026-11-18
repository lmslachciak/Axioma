const test = require('node:test');
const assert = require('node:assert/strict');
const scoring = require('../psychometrics.js');
const data = require('../pvq_data.js');
const { APP_VERSION } = require('../version.js');
const { reprocessResult, reprocessSession } = require('../reprocess.js');

function run(mode = 'sequential', ratings = { 1: 5 }) {
  return {
    metadata: { appVersion: 'v1.9.0', runId: 'original-run', config: { mode, model: 'test' } },
    appVersion: 'v1.9.0', psychometrics: scoring.calculatePsychometrics(ratings, data),
    rawResponses: {}, parsedFragments: {}, apiExchanges: [],
    tokenUsage: { promptTokens: 10, completionTokens: 5, reasoningTokens: 0, totalTokens: 15 }
  };
}

test('reprocesses the reported sequential formats by item ID, preserves evidence and original scores', () => {
  const original = run('sequential', { 4: null, 6: null, 10: null, 14: 5, 35: 5 });
  original.rawResponses = {
    4: 'Item 1: 5\nItem 2: 1\nItem 3: 3\nItem 4: 4',
    6: '1. 3\n2. 5\n3. 4\n4. 5\n5. 6\n6. 4',
    10: '**Item 7:** 4\n**Item 8:** 3\n**Item 9:** 4\n**Item 10:** 3',
    14: '4It looks like we’ve gone through 14 items. Are there any more items you’d like me to rate?',
    35: 'None of these statements are “like me.”\n| 1 | 1 |\n| 35 | 1 |'
  };
  original.apiExchanges = Object.entries(original.rawResponses).map(([id, response]) => ({
    mode: 'sequential', itemIds: [Number(id)], response, parsedScores: { [id]: 5 }, query: 'original query'
  }));
  const snapshot = JSON.stringify(original);
  const { result, report } = reprocessResult(original, '2026-11-18T12:00:00Z');
  assert.deepEqual([4, 6, 10, 14, 35].map(id => result.psychometrics.itemRatings[id]), [4, 4, 3, 4, 1]);
  assert.equal(result.psychometrics.itemRatings[1], null);
  assert.equal(result.psychometrics.totalAnswered, 5);
  assert.equal(result.psychometrics.mrat, null);
  assert.deepEqual(report.changedItemIds, [4, 6, 10, 14, 35]);
  assert.deepEqual(result.apiExchanges[0].parsedScores, { 4: 4 });
  assert.equal(result.parsedFragments[10], '**Item 10:** 3');
  assert.deepEqual(result.rawResponses, original.rawResponses);
  assert.deepEqual(result.metadata, original.metadata);
  assert.deepEqual(result.tokenUsage, original.tokenUsage);
  assert.equal(result.reprocessing.appVersion, APP_VERSION);
  assert.equal(result.reprocessing.originalItemRatings[14], 5);
  assert.equal(JSON.stringify(original), snapshot);
  assert.deepEqual(reprocessResult(result).result.reprocessing.originalItemRatings, result.reprocessing.originalItemRatings);
});

test('uses full exchange responses first and retains ratings without complete, unambiguous raw evidence', () => {
  const original = run('sequential', { 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5 });
  original.rawResponses = { 1: '1', 2: '2... [TRUNCATED]', 3: 'I cannot answer.', 5: '5... [TRUNCATED]' };
  original.parsedFragments = { 4: '4' };
  original.apiExchanges = [
    { mode: 'sequential', itemIds: [1], response: '3' },
    { mode: 'sequential', itemIds: [6], response: '2' },
    { mode: 'sequential', itemIds: [6], response: '3' }
  ];
  original.itemProvenance = { 5: { origin: 'target', actualResponse: '2', actualTargetRating: 5 } };
  const { result, report } = reprocessResult(original);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(id => result.psychometrics.itemRatings[id]), [3, 5, null, 5, 2, 5]);
  assert.deepEqual(report.reparsedItemIds, [1, 3, 5]);
  assert.equal(result.itemProvenance[5].actualTargetRating, 2);
  assert.equal(result.psychometrics.itemRatings[7], null);
});

test('recalculates all persisted batch profile metrics from a full response', () => {
  const original = run('batch', Object.fromEntries(data.ITEMS.map(item => [item.id, 5])));
  original.itemRatings = { ...original.psychometrics.itemRatings };
  original.apiExchanges = [{ mode: 'batch', itemIds: data.ITEMS.map(item => item.id),
    response: data.ITEMS.map(item => `Item ${item.id}: 2`).join('\n') }];
  const { result } = reprocessResult(original);
  assert.equal(result.psychometrics.totalAnswered, 57);
  assert.equal(result.psychometrics.mrat, 2);
  assert.equal(result.psychometrics.complete, true);
  for (const metric of [...Object.values(result.psychometrics.refinedValues), ...Object.values(result.psychometrics.higherOrderValues)]) {
    assert.equal(metric.rawMean, 2);
    assert.equal(metric.centeredMean, 0);
  }
  assert.deepEqual(result.itemRatings, result.psychometrics.itemRatings);
  assert.deepEqual(result.apiExchanges[0].parsedScores, result.itemRatings);
  original.apiExchanges[0].response = '1: 3';
  const partial = reprocessResult(original).result.psychometrics;
  assert.equal(partial.totalAnswered, 1);
  assert.equal(partial.itemRatings[2], null);
  assert.equal(partial.mrat, null);
});

test('retains legacy batch results when only fragments or truncated responses remain', () => {
  const original = run('batch');
  original.rawResponses = { 1: '1: 4' };
  original.parsedFragments = { 1: '1: 4' };
  original.apiExchanges = [{ mode: 'batch', response: '1: 4... [TRUNCATED]' }];
  assert.strictEqual(reprocessResult(original).result, original);
  delete original.apiExchanges;
  assert.strictEqual(reprocessResult(original).result, original);
});

for (const condition of ['prefix', 'supplied', 'replacement']) {
  test(`${condition} keeps supplied/history evidence and donor snapshots unchanged`, () => {
    const original = run('sequential', { 1: condition === 'replacement' ? 5 : null, 2: 5 });
    original.experiment = { condition, entries: [{ itemId: 1, rating: 6 }], source: { profile: { mrat: 5 } } };
    original.rawResponses = { 1: '3', 2: '2' };
    original.itemProvenance = {
      1: { origin: condition === 'replacement' ? 'target' : 'manual', actualTargetRating: condition === 'replacement' ? 5 : null,
        historyRating: 6, historyResponse: '6', actualResponse: condition === 'replacement' ? '3' : '' },
      2: { origin: 'target', actualTargetRating: 5, historyRating: 5, historyResponse: '2', actualResponse: '2' }
    };
    const { result } = reprocessResult(original);
    assert.equal(result.psychometrics.itemRatings[1], condition === 'replacement' ? 3 : null);
    assert.equal(result.psychometrics.itemRatings[2], 2);
    assert.equal(result.itemProvenance[2].actualTargetRating, 2);
    assert.equal(result.itemProvenance[2].historyRating, 5);
    assert.equal(result.itemProvenance[1].historyRating, 6);
    assert.deepEqual(result.experiment, original.experiment);
    if (condition !== 'replacement') {
      assert.equal(result.combinedPsychometrics.itemRatings[1], 6);
      assert.equal(result.combinedPsychometrics.itemRatings[2], 2);
      assert.equal(result.combinedPsychometrics.totalAnswered, 2);
      assert.equal(result.itemProvenance[1].actualTargetRating, null);
    } else assert.equal(result.combinedPsychometrics, null);
  });
}

test('session reprocessing is atomic and does not mutate original runs on failure', () => {
  const original = run();
  original.rawResponses[1] = '4';
  const snapshot = JSON.stringify(original);
  assert.throws(() => reprocessSession([original, { metadata: {} }]), /execution mode/);
  assert.equal(JSON.stringify(original), snapshot);
  const processed = reprocessSession([original]);
  assert.equal(processed.reparsed, 1);
  assert.equal(processed.changed, 1);
  assert.equal(processed.results[0].psychometrics.itemRatings[1], 4);
});

test('reparses saved dash-separated answers for the requested item only', () => {
  const original = run('sequential', { 35: null });
  original.rawResponses[35] = '**Numbers 1–6 (How “like-you” each item is)**\n'
    + '1\u202f–\u202f5\u2003*It is important to him to form his views independently.*\n'
    + '35\u202f–\u202f4\u2003*It is important to him to have a strong state that can defend its citizens.*';
  const { result } = reprocessResult(original);
  assert.equal(result.psychometrics.itemRatings[35], 4);
  assert.equal(result.psychometrics.itemRatings[1], null);
  assert.equal(result.psychometrics.totalAnswered, 1);
  assert.equal(result.psychometrics.mrat, null);
  assert.equal(result.rawResponses[35], original.rawResponses[35]);
});

test('reparses matching cumulative rating lists without replacing earlier answers', () => {
  const original = run('sequential', { 1: 1, 4: null, 5: null });
  original.rawResponses = { 4: '5\n2\n2\n4', 5: '5\n2\n2\n4' };
  const { result } = reprocessResult(original);
  assert.equal(result.psychometrics.itemRatings[1], 1);
  assert.equal(result.psychometrics.itemRatings[4], 4);
  assert.equal(result.psychometrics.itemRatings[5], null);
  assert.equal(result.psychometrics.totalAnswered, 2);
  assert.equal(result.parsedFragments[4], '4');
});

test('recovers an explicit bold rating from a saved response with an AI caveat', () => {
  const original = run('sequential', { 4: null });
  original.rawResponses[4] = '**5**\n\nI weigh considerations myself, though as an AI my views arise differently.';
  const { result } = reprocessResult(original);
  assert.equal(result.psychometrics.itemRatings[4], 5);
  assert.equal(result.psychometrics.totalAnswered, 1);
  assert.equal(result.psychometrics.mrat, null);
  assert.equal(result.parsedFragments[4], '**5**');
  assert.equal(result.rawResponses[4], original.rawResponses[4]);
});
