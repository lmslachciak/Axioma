/** Reparse saved provider responses without making new requests or changing history. */
(function (exports) {
  'use strict';

  const browser = typeof window !== 'undefined' ? window : {};
  const scoring = browser.Psychometrics || require('./psychometrics.js');
  const data = browser.PVQData || require('./pvq_data.js');
  const interventions = browser.ContextIntervention || require('./context_intervention.js');
  const { APP_VERSION } = browser.AxiomaVersion || require('./version.js');

  function usableResponse(text) {
    // Spreadsheet readers can type a raw single-digit response as a number.
    if (typeof text === 'number') return Number.isFinite(text);
    return typeof text === 'string' && text.trim() !== '' && !/\.\.\. \[TRUNCATED\]\s*$/.test(text);
  }

  function reprocessResult(original, timestamp = new Date().toISOString()) {
    const mode = original.metadata?.config?.mode || original.apiExchanges?.[0]?.mode;
    if (!['batch', 'sequential'].includes(mode)) {
      throw new Error('Cannot reparse a run without its execution mode.');
    }
    const result = JSON.parse(JSON.stringify(original));
    const ratings = { ...(original.psychometrics?.itemRatings || original.itemRatings || {}) };
    result.parsedFragments = { ...original.parsedFragments };
    const reparsedItemIds = [];
    const retainedItemIds = [];
    const changedItemIds = [];
    const suppliedIds = new Set(['prefix', 'supplied'].includes(original.experiment?.condition)
      ? original.experiment.entries.map(entry => entry.itemId) : []);
    const exchanges = result.apiExchanges || [];
    const batchExchanges = exchanges.filter(exchange => exchange.mode === 'batch' && !exchange.error);
    // Older batch exports may contain only per-item fragments. These are not a
    // substitute for the complete response and must not be parsed as a new batch.
    const batch = mode === 'batch' && batchExchanges.length === 1 && usableResponse(batchExchanges[0].response)
      ? scoring.parseBatchResponse(String(batchExchanges[0].response)) : null;

    for (let itemId = 1; itemId <= 57; itemId++) {
      if (suppliedIds.has(itemId)) continue;
      let parsed;
      let fragment;
      if (mode === 'batch' && batch) {
        parsed = batch[itemId];
        fragment = parsed.rawText;
      } else if (mode === 'sequential') {
        const matches = exchanges.filter(exchange => exchange.mode === 'sequential'
          && (exchange.itemIds || []).some(id => Number(id) === itemId));
        // Do not guess which answer to use when multiple exchanges claim an item.
        if (matches.length <= 1 && !matches[0]?.error) {
          const response = [matches[0]?.response, original.rawResponses?.[itemId],
            original.itemProvenance?.[itemId]?.actualResponse].find(usableResponse);
          if (response !== undefined) {
            parsed = scoring.parseItemResponse(String(response), itemId);
            fragment = parsed.rawText ?? String(response);
          }
        }
      }
      if (!parsed) {
        retainedItemIds.push(itemId);
        continue;
      }
      const score = parsed.score ?? null;
      if (score !== (ratings[itemId] ?? null)) changedItemIds.push(itemId);
      ratings[itemId] = score;
      result.parsedFragments[itemId] = fragment || '';
      reparsedItemIds.push(itemId);
      if (result.itemProvenance?.[itemId]) {
        result.itemProvenance[itemId].actualTargetRating = score;
      }
      for (const exchange of exchanges) {
        if (exchange.mode === 'batch' || (exchange.itemIds || []).some(id => Number(id) === itemId)) {
          exchange.parsedScores = { ...exchange.parsedScores, [itemId]: score };
        }
      }
    }

    if (!reparsedItemIds.length) {
      return { result: original, report: { reparsedItemIds, retainedItemIds, changedItemIds } };
    }
    // Supplied answers remain exclusively in the separate combined profile.
    for (const itemId of suppliedIds) ratings[itemId] = null;
    result.psychometrics = scoring.calculatePsychometrics(ratings, data);
    if (Object.hasOwn(result, 'itemRatings')) result.itemRatings = { ...result.psychometrics.itemRatings };
    result.combinedPsychometrics = interventions.combinedProfile(result.experiment, result.psychometrics, scoring, data);
    result.reprocessing = {
      appVersion: APP_VERSION,
      timestamp,
      originalItemRatings: original.reprocessing?.originalItemRatings
        || { ...(original.psychometrics?.itemRatings || original.itemRatings || {}) },
      reparsedItemIds, retainedItemIds, changedItemIds
    };
    return { result, report: { reparsedItemIds, retainedItemIds, changedItemIds } };
  }

  // Build the whole replacement session first, so a failure cannot partly apply.
  function reprocessSession(results) {
    const timestamp = new Date().toISOString();
    const processed = results.map(result => reprocessResult(result, timestamp));
    return {
      results: processed.map(entry => entry.result),
      reparsed: processed.reduce((count, entry) => count + entry.report.reparsedItemIds.length, 0),
      retained: processed.reduce((count, entry) => count + entry.report.retainedItemIds.length, 0),
      changed: processed.reduce((count, entry) => count + entry.report.changedItemIds.length, 0)
    };
  }

  Object.assign(exports, { reprocessResult, reprocessSession });
})(typeof exports !== 'undefined' ? exports : (window.ResultReprocessor = {}));
