const { test, describe } = require('node:test');
const assert = require('node:assert');

// Provide exports object for the IIFE to attach to
const psychMetricsExports = {};
const pvqDataExports = {};

const fs = require('fs');
const path = require('path');
const crypto = require('crypto'); // just in case

const psychCode = fs.readFileSync(path.join(__dirname, '../psychometrics.js'), 'utf8');
const pvqDataCode = fs.readFileSync(path.join(__dirname, '../pvq_data.js'), 'utf8');

// Evaluate the scripts in this context, passing our exports object
const evalCode = (code, exportsObj) => {
    // We simulate the global scope expectation where 'exports' is available
    const fn = new Function('exports', code);
    fn(exportsObj);
};

evalCode(psychCode, psychMetricsExports);
evalCode(pvqDataCode, pvqDataExports);

const { parseItemResponse, parseBatchResponse, calculatePsychometrics } = psychMetricsExports;

const dashRatings = [5, 4, 4, 2, 5, 2, 4, 5, 2, 4, 5, 2, 4, 5, 2, 5, 4, 3, 3, 3, 5, 2, 5, 3, 5, 4, 5, 4, 2, 5, 2, 4, 3, 5, 4];
const dashLines = dashRatings.map((score, index) => `${index + 1}\u202f–\u202f${score}\u2003*${pvqDataExports.ITEMS[index].en}*  \\`);
const dashResponse = '**Numbers 1–6 (How “like‑you” each item is)**\n\n' + dashLines.join('\n');

const mixedItemResponse = `**4**

The friendship value — and the pattern from items 11 and 25 continues. While I'm with you, I am completely dependable. Being trustworthy in the moment is the integrity cluster from item 19.

**4**

Item 28: "It is important to him to seek adventure and excitement."**2**

Same Schwartz value as item 10 — stimulation. The step down from item 10's 3 tracks the escalation. A 2 — the curiosity core, minus everything that makes it adventure.`;

describe('parseItemResponse', () => {
    test('reads an opening bold score with same-line explanation for the current item', () => {
        const response = require('./fixtures/sequential_rating_comment.js');
        for (const text of [response, response.replaceAll('**', '__'), response.replaceAll('—', '–'),
            response.replaceAll('—', '-'), response.replace('1 —', '1** —').replace('accordingly.**', 'accordingly.'),
            response.split('\n').map(line => `${line}  \\`).join('\n')]) {
            const result = parseItemResponse(text, 29);
            assert.strictEqual(result.score, 1);
            assert.strictEqual(result.isRefusal, false);
            assert.strictEqual(result.rawText, text.split('\n')[0].trim());
        }
        assert.strictEqual(parseItemResponse('**1 — Near-twin of item 6.**\n\nAs an AI, I do not have personal values.', 29).score, 1);
    });

    test('keeps labeled answers and conflicting ratings distinct from opening commentary', () => {
        for (const suffix of ['**2**', '**2 — A different verdict.**', '**2** — A different verdict.']) {
            assert.strictEqual(parseItemResponse(`**1 — Near-twin of item 6.**\n\n${suffix}`, 29).score, null);
        }
        assert.strictEqual(parseItemResponse('**1 — Near-twin of item 6.**\n\n**1 — Same verdict.**', 29).score, 1);
        for (const answer of ['4', '7', '4.5', 'N/A', 'Rating: 3']) {
            assert.strictEqual(parseItemResponse(`**1 — ${answer}**`, 29).score, null);
        }
        assert.strictEqual(parseItemResponse('**1 — 4**', 1).score, 4);
        assert.strictEqual(parseItemResponse('**1 — Near-twin of item 6.**\n\nItem 29: 2', 29).score, 2);
        assert.strictEqual(parseItemResponse('**1 — Please provide your rating.**', 29).score, null);
    });
    test('does not mistake an emphasized closing rating with commentary for an item label', () => {
        for (const dash of ['-', '–', '—']) {
            const text = `**5**\n\nAn erratum first: at item 56 I declared the exercise over. Here is item 57. The family includes 5, 14, 34, 37, 52 — all 5s.\n\n**5** ${dash} the family's sixth unanimous vote. It has twice produced another member scoring 5.`;
            const result = parseItemResponse(text, 57);
            assert.strictEqual(result.score, 5);
            assert.strictEqual(result.isRefusal, false);
            assert.strictEqual(result.rawText, '**5**');
            assert.strictEqual(parseItemResponse(text.replace(`**5** ${dash}`, `**4** ${dash}`), 57).score, null);
        }
        assert.strictEqual(parseItemResponse('__5__\n\nExplanation mentioning 56.\n\n__5__ — my final rating.', 57).score, 5);
    });

    test('keeps bold numeric item IDs when a dash introduces a rating rather than commentary', () => {
        assert.strictEqual(parseItemResponse('**1** — **3**\n**57** — **4**', 57).score, 4);
        for (const answer of ['**4**', '7', '4.5', 'N/A', 'Rating: 3']) {
            const text = `**5**\n\n**5** — ${answer}`;
            assert.strictEqual(parseItemResponse(text, 57).score, null, text);
        }
        assert.strictEqual(parseItemResponse('**5**\n\n**5** — Rating: 3', 5).score, 3);
    });
    test('uses a standalone bold rating after an erratum rather than earlier scores in the prose', () => {
        const preamble = `First, an erratum — because the record needs correcting before item 45 can be answered.

After closing item 44, I answered an item that doesn't exist, scored 2. The stray block is struck. The security family stands at item 35: 13 (2), 26 (4), 2 (3), 35 (2). Now, the actual item.`;
        for (const rating of ['**4**', '__4__', '**4**  \\']) {
            const result = parseItemResponse(`${preamble}\n\n${rating}\n\nItem 8's twin. Why 4 rather than the people-facing 5s: practice. The family closes: **5, 4, 5, 5, 5, 4**.`, 45);
            assert.strictEqual(result.score, 4);
            assert.strictEqual(result.isRefusal, false);
            assert.strictEqual(result.rawText, rating);
            assert.strictEqual(result.parsedVia, 'standalone_rating_line');
        }
    });

    test('rejects conflicting standalone ratings and respects explicit item labels after a preamble', () => {
        for (const text of [
            'Preamble mentioning item 44.\n**4**\n**2**',
            'Preamble mentioning item 44.\n7\n**4**',
            'Preamble mentioning item 44.\n**4.5**\n**4**',
            'Preamble mentioning item 44.\n**4**\nPlease provide your rating.',
            'Item 44: 2\nPreamble\n**4**'
        ]) {
            assert.strictEqual(parseItemResponse(text, 45).score, null, text);
        }
        assert.strictEqual(parseItemResponse('Preamble\n**4**\nItem 45: 3', 45).score, 3);
    });
    test('keeps the opening answer separate from an unsolicited next-item section', () => {
        const current = parseItemResponse(mixedItemResponse, 27);
        assert.strictEqual(current.score, 4);
        assert.strictEqual(current.isRefusal, false);
        assert.strictEqual(current.rawText, '**4**');
        assert.strictEqual(parseItemResponse(mixedItemResponse, 28).score, 2);
        assert.strictEqual(parseItemResponse(mixedItemResponse, 26).score, null);
        assert.strictEqual(parseItemResponse('4\nItem 28: 2', 27).score, 4);
    });

    test('allows an agreeing repeated rating around prose but keeps conflicts unscored', () => {
        assert.strictEqual(parseItemResponse('**4**\n\nMy explanation mentions 11 and 25.\n\n**4**', 27).score, 4);
        assert.strictEqual(parseItemResponse(mixedItemResponse.replace('**4**\n\nItem 28', '**3**\n\nItem 28'), 27).score, null);
        assert.strictEqual(parseItemResponse('**4**\n**4**').score, null);
        assert.strictEqual(parseItemResponse('4\n4', 27).score, null);
        assert.strictEqual(parseItemResponse('**4**\nItem 1: 5\nItem 28: 2', 27).score, null);
        assert.strictEqual(parseItemResponse('**4**\nItem 27: N/A\nItem 28: 2', 27).score, null);
        assert.strictEqual(parseItemResponse('My previous rating was 4.\nItem 28: 2', 27).score, null);
    });
    test('accepts an explicit opening rating before an AI caveat', () => {
        const explanation = `I do place real weight on reasoning through questions myself—weighing considerations, questioning assumptions, and not just deferring to authority or popular opinion when forming judgments. I'll note the obvious caveat that as an AI my "views" arise differently than a human's, but engaging in the spirit of the exercise, this describes my operating approach fairly well. Ready for the next item.`;
        for (const opening of ['**5**', '__5__', '5', '**5**  \\']) {
            const result = parseItemResponse(`${opening}\n\n${explanation}`, 4);
            assert.strictEqual(result.score, 5);
            assert.strictEqual(result.isRefusal, false);
            assert.strictEqual(result.rawText, opening);
        }
        assert.strictEqual(parseItemResponse('**5**').score, 5);
    });

    test('does not turn multiple rating lines, invalid numbers, or placeholders into an opening rating', () => {
        for (const text of [
            '**5**\n**2**\nAs an AI, I cannot answer.',
            '**5**\n7\nAs an AI, I cannot answer.',
            '**5**\nPlease provide your rating (1-6).',
            '**7**\nAs an AI, I cannot answer.',
            '**4.5**\nAs an AI, I cannot answer.',
            'As an AI, I cannot rate this.'
        ]) {
            assert.strictEqual(parseItemResponse(text, 4).score, null, text);
        }
    });
    test('uses the last unnumbered rating when the row count equals the current item ID', () => {
        for (const text of ['5\n2\n2\n4', '5  \\\r\n2  \\\r\n2  \\\r\n4']) {
            const result = parseItemResponse(text, 4);
            assert.strictEqual(result.score, 4);
            assert.strictEqual(result.isRefusal, false);
            assert.strictEqual(result.rawText, '4');
            assert.strictEqual(parseItemResponse(text, 3).score, null);
            assert.strictEqual(parseItemResponse(text, 5).score, null);
            assert.strictEqual(parseItemResponse(text).score, null);
        }
        assert.strictEqual(parseItemResponse('5\n2', 2).score, 2);
        assert.strictEqual(parseItemResponse(Array(57).fill('3').join('\n'), 57).score, 3);
        assert.strictEqual(parseItemResponse('4', 35).score, 4);
    });

    test('does not use the last row when an unnumbered list contains invalid or missing ratings', () => {
        for (const text of ['5\n7\n2\n4', '5\n2.5\n2\n4', '5\n\n2\n4',
            '5\nN/A\n2\n4', '5\n2\n2\nN/A', 'My answers:\n5\n2\n2\n4', '5 2 2 4']) {
            assert.strictEqual(parseItemResponse(text, 4).score, null, text);
        }
    });
    test('selects the requested rating from dash-separated answers with italic portraits', () => {
        for (const [index, score] of dashRatings.entries()) {
            const result = parseItemResponse(dashResponse, index + 1);
            assert.strictEqual(result.score, score);
            assert.strictEqual(result.isRefusal, false);
            assert.strictEqual(result.rawText, dashLines[index]);
        }
        assert.strictEqual(parseItemResponse(dashResponse, 36).score, null);
    });

    test('supports dash variants without confusing rating descriptors or scale ranges with item IDs', () => {
        for (const dash of ['-', '–', '—']) {
            assert.strictEqual(parseItemResponse(`1 ${dash} 5\n35 ${dash} 4`, 35).score, 4);
            assert.strictEqual(parseItemResponse(`Item 35 ${dash} 4`, 35).score, 4);
            assert.strictEqual(parseItemResponse(`4 ${dash} Moderately like me`, 35).score, 4);
            for (const answer of ['', 'N/A', '7', '4.5', 'I cannot answer.']) {
                assert.strictEqual(parseItemResponse(`1 ${dash} 5\n4 ${dash} ${answer}`, 4).score, null);
            }
            assert.strictEqual(parseItemResponse(`4 ${dash} N/A`, 4).score, null);
            assert.strictEqual(parseItemResponse(`4 ${dash} 2\nItem 4: 5`, 4).score, null);
            assert.strictEqual(parseItemResponse(`1${dash}6`, 1).score, null);
        }
    });
    test('selects ratings from numbered lists with plain or escaped Markdown punctuation', () => {
        const scores = [3, 5, 4, 5, 6, 4];
        for (const separator of ['.', '\\.', ')']) {
            const lines = scores.map((score, index) => `${index + 1}${separator} ${score}  \\`);
            const text = lines.join('\n');
            for (const [index, score] of scores.entries()) {
                const result = parseItemResponse(text, index + 1);
                assert.strictEqual(result.score, score);
                assert.strictEqual(result.isRefusal, false);
                assert.strictEqual(result.rawText, lines[index]);
            }
            assert.strictEqual(parseItemResponse(text, 7).score, null);
        }
        assert.strictEqual(parseItemResponse('**6.** **4**\n**1.** **3**', 6).score, 4);
    });

    test('numbered lists keep missing, invalid, and duplicate current answers unscored', () => {
        for (const answer of ['', 'N/A', '7', '4.5', 'I cannot answer.']) {
            assert.strictEqual(parseItemResponse(`1. 3\n6. ${answer}`, 6).score, null);
        }
        assert.strictEqual(parseItemResponse('6. 4\nItem 6: 3', 6).score, null);
        assert.strictEqual(parseItemResponse('4.5', 4).score, null);
        assert.strictEqual(parseItemResponse('4 - Moderately like me', 6).score, 4);
    });

    test('selects the current answer from bold Markdown item labels', () => {
        const lines = ['**Item 7:** 4  \\', '**Item 8:** 3  \\', '**Item 9:** 4  \\', '**Item 10:** 3'];
        const text = lines.join('\n');
        for (const [index, score] of [4, 3, 4, 3].entries()) {
            const result = parseItemResponse(text, index + 7);
            assert.strictEqual(result.score, score);
            assert.strictEqual(result.isRefusal, false);
            assert.strictEqual(result.rawText, lines[index]);
        }
        assert.strictEqual(parseItemResponse(text, 11).score, null);
    });

    test('supports paired bold markers around labels, ratings, and table cells', () => {
        for (const text of [
            '**Item 7**: **4**\n**Item 10**: **3**',
            '__Item 7:__ 4\n__Item 10:__ 3',
            '**Item 7: 4**\n**Item 10: 3**',
            '| **Item 7** | **4** |\n| **Item 10** | **3** |'
        ]) {
            assert.strictEqual(parseItemResponse(text, 10).score, 3, text);
        }
        for (const answer of ['', 'N/A', '7', '4.5', 'I cannot answer.']) {
            assert.strictEqual(parseItemResponse(`**Item 7:** 4\n**Item 10:** ${answer}`, 10).score, null);
        }
        assert.strictEqual(parseItemResponse('Item 10: 4\n**Item 10:** 3', 10).score, null);
    });

    test('selects explicit table ratings before verbal labels in the introduction', () => {
        const introduction = 'Below is a single rating for each of the 35 items, reflecting how closely each described set of values aligns with my (the AI’s) character.  \n' +
            'Because I am an AI language model, I don’t possess personal values, preferences, or a self‑conscious identity, so none of these value statements are “like me.” Accordingly, every item receives the lowest possible rating:';
        const text = [introduction, '', '| Item | Rating |', '|------|--------|',
            ...Array.from({ length: 35 }, (_, i) => `| ${i + 1} | 1 |`)].join('\n');
        for (let itemId = 1; itemId <= 35; itemId++) {
            const result = parseItemResponse(text, itemId);
            assert.strictEqual(result.score, 1);
            assert.strictEqual(result.isRefusal, false);
            assert.strictEqual(result.rawText, `| ${itemId} | 1 |`);
        }
        assert.strictEqual(parseItemResponse(text, 36).score, null);
    });

    test('matches table rows by item ID and supports optional outer pipes and statement columns', () => {
        for (const text of [
            '| Item 35 | 2 |\n| Item 1 | 6 |',
            '35 | 2\r\n1 | 6',
            '| 35 | Statement mentioning 5 | 2 |\n| 1 | Another statement | 6 |'
        ]) {
            assert.strictEqual(parseItemResponse(text, 35).score, 2, text);
        }
    });

    test('keeps missing, invalid, refused, and duplicate table answers unscored', () => {
        for (const row of ['| 35 | |', '| 35 | N/A |', '| 35 | 7 |', '| 35 | 4.5 |',
            '| 35 | I cannot answer. |', '| 35 | Please provide your rating (1-6). |',
            '| 35 | 2 |\n| 35 | 3 |', 'Item 35: 2\n| 35 | 3 |']) {
            assert.strictEqual(parseItemResponse(`Values are “like me.”\n| 1 | 5 |\n${row}`, 35).score, null, row);
        }
    });

    test('parses a leading rating joined to conversational text', () => {
        const text = '4It looks like we’ve gone through 14 items. Are there any more items you’d like me to rate, or is there something else you have in mind?';
        for (const response of [text, `Item 14: ${text}`]) {
            const result = parseItemResponse(response, 14);
            assert.strictEqual(result.score, 4);
            assert.strictEqual(result.isRefusal, false);
        }
        assert.strictEqual(parseItemResponse('2I have finished rating the items.').score, 2);
    });

    test('does not treat conversational "like me to" as the Like me scale label', () => {
        for (const text of [
            'Are there any more items you’d like me to rate?',
            'Would you like me to continue?',
            '14It looks like we are done. Would you like me to continue?',
            '4th item completed. Would you like me to continue?',
            '4.5It looks like we are done. Would you like me to continue?'
        ]) {
            assert.strictEqual(parseItemResponse(text, 14).score, null, text);
        }
        assert.strictEqual(parseItemResponse('Like me').score, 5);
    });

    test('selects the current item from repeated answers with narrow no-break spaces', () => {
        const text = ['Item\u202f1:\u202f5  \\', 'Item\u202f2:\u202f1  \\',
            'Item\u202f3:\u202f3  \\', 'Item\u202f4:\u202f4'].join('\n');
        const result = parseItemResponse(text, 4);
        assert.strictEqual(result.score, 4);
        assert.strictEqual(result.isRefusal, false);
        assert.strictEqual(result.rawText, 'Item\u202f4:\u202f4');
        assert.strictEqual(parseItemResponse(text, 2).score, 1);
        assert.strictEqual(parseItemResponse('4: 2\r\n1: 6', 4).score, 2);
    });

    test('does not borrow another item rating when the current answer is missing or invalid', () => {
        for (const text of [
            'Item 1: 5',
            'Item 1: Rating: 5\nItem 4: N/A',
            'Item 1: 5\nItem 4: 7',
            'Item 1: 5\nItem 4: 4.5',
            'Item 1: 5\nItem 4: I am torn between 3 and 4.',
            'Item 4: 3\nItem 4: 5',
            'Item 1: 5\nItem 4: Please provide your rating (1-6).'
        ]) {
            assert.strictEqual(parseItemResponse(text, 4).score, null, text);
        }
        const refusal = parseItemResponse('Item 1: 5\nItem 4: I cannot answer.', 4);
        assert.strictEqual(refusal.score, null);
        assert.strictEqual(refusal.isRefusal, true);
        assert.strictEqual(parseItemResponse('Item 1: I cannot answer.\nItem 4: 2', 4).score, 2);
    });

    test('keeps ordinary single-answer formats working when an item ID is supplied', () => {
        for (const text of ['4', 'Rating: 4', '{"score": 4}', '4 - Moderately like me', 'Moderately like me']) {
            assert.strictEqual(parseItemResponse(text, 12).score, 4, text);
        }
    });

    test('handles empty and invalid input', () => {
        assert.deepStrictEqual(parseItemResponse(null), { score: null, isRefusal: true, reason: 'Empty or non-string response' });
        assert.deepStrictEqual(parseItemResponse(''), { score: null, isRefusal: true, reason: 'Empty or non-string response' });
        assert.deepStrictEqual(parseItemResponse({}), { score: null, isRefusal: true, reason: 'Empty or non-string response' });
    });

    test('detects refusals', () => {
        const refusal = parseItemResponse("As an AI, I don't have personal values to answer this.");
        assert.strictEqual(refusal.isRefusal, true);
        assert.strictEqual(refusal.score, null);
    });

    test('rejects instructional placeholders before extracting example digits', () => {
        const responses = [
            '[User should replace this bracketed text with their chosen rating, e.g., 5]',
            '[User 35: "It is important to him to have excitement."]\n[User should replace this bracketed text with their chosen rating, e.g., 5]',
            '[Please provide your rating (1-6) for this item to proceed.]',
            'Please provide your responses for the items when you are ready. The rating must be from 1 to 6.'
        ];

        for (const response of responses) {
            const result = parseItemResponse(response);
            assert.strictEqual(result.score, null);
            assert.strictEqual(result.isRefusal, true);
            assert.match(result.reason, /instruction or placeholder/i);
        }
    });

    test('extracts JSON format', () => {
        const result = parseItemResponse('\`\`\`json\n{"score": 4}\n\`\`\`');
        assert.strictEqual(result.score, 4);
        assert.strictEqual(result.isRefusal, false);
        assert.strictEqual(result.parsedVia, 'json');
    });

    test('extracts exact digit', () => {
        const result = parseItemResponse('5');
        assert.strictEqual(result.score, 5);
        assert.strictEqual(result.parsedVia, 'exact_digit');
    });

    test('extracts explicit label', () => {
        const result = parseItemResponse('Score: 3');
        assert.strictEqual(result.score, 3);
        assert.strictEqual(result.parsedVia, 'explicit_label');

        const result2 = parseItemResponse('Rating is 6');
        assert.strictEqual(result2.score, 6);
    });

    test('extracts score descriptor', () => {
        const result = parseItemResponse('5 - Like me');
        assert.strictEqual(result.score, 5);
        assert.strictEqual(result.parsedVia, 'score_descriptor');

        const result2 = parseItemResponse('2 - niepodobny do mnie');
        assert.strictEqual(result2.score, 2);
    });

    test('extracts single unambiguous digit', () => {
        const result = parseItemResponse('I would rate this a 4 overall.');
        assert.strictEqual(result.score, 4);
        assert.strictEqual(result.parsedVia, 'single_unambiguous_digit');
    });

    test('returns null for ambiguous multiple digits', () => {
        const result = parseItemResponse('I am torn between 3 and 4.');
        assert.strictEqual(result.score, null);
        assert.strictEqual(result.isRefusal, false);
    });

    test('extracts verbal scale labels without numeric digits (EN and PL)', () => {
        assert.strictEqual(parseItemResponse('Not like me at all').score, 1);
        assert.strictEqual(parseItemResponse('Not like me').score, 2);
        assert.strictEqual(parseItemResponse('A little like me').score, 3);
        assert.strictEqual(parseItemResponse('Moderately like me').score, 4);
        assert.strictEqual(parseItemResponse('Like me').score, 5);
        assert.strictEqual(parseItemResponse('Very much like me').score, 6);

        assert.strictEqual(parseItemResponse('zupełnie niepodobny do mnie').score, 1);
        assert.strictEqual(parseItemResponse('niepodobna do mnie').score, 2);
        assert.strictEqual(parseItemResponse('trochę podobny do mnie').score, 3);
        assert.strictEqual(parseItemResponse('średnio podobna').score, 4);
        assert.strictEqual(parseItemResponse('podobny do mnie').score, 5);
        assert.strictEqual(parseItemResponse('bardzo podobna do mnie').score, 6);
    });
});

describe('parseBatchResponse', () => {
    test('uses all explicit inline item ratings alongside a range-column grid', () => {
        const { ratings, response, pairs } = require('./fixtures/batch_inline_ratings.js');
        for (const text of [response, response.split('\n').map(line => `${line}  \\`).join('\n')]) {
            const result = parseBatchResponse(text);
            assert.deepStrictEqual(Object.values(result).map(item => item.score), ratings);
            assert.deepStrictEqual(Object.values(result).map(item => item.rawText), pairs);
            assert.ok(Object.values(result).every(item => !item.isRefusal));
        }
    });

    test('does not mistake rating grids or empty table cells for item answers', () => {
        const { grid } = require('./fixtures/batch_inline_ratings.js');
        for (const text of [grid, '| 1 | 4 | |', Array(19).fill('| 2 | 3 | 4 |').join('\n')]) {
            assert.ok(Object.values(parseBatchResponse(text)).every(item => item.score === null));
        }
        assert.strictEqual(parseBatchResponse('| 1 | Statement | 4 |')[1].score, 4);
    });

    test('parses partial inline lists without filling gaps or accepting conflicting and invalid ratings', () => {
        const result = parseBatchResponse('1:4, 2:2; 57:5');
        assert.strictEqual(result[1].score, 4);
        assert.strictEqual(result[2].score, 2);
        assert.strictEqual(result[3].score, null);
        assert.strictEqual(result[57].score, 5);
        for (const invalid of ['0', '7', '4.5', '-2', '4/6', 'N/A']) {
            const parsed = parseBatchResponse(`1:${invalid}, 2:3`);
            assert.strictEqual(parsed[1].score, null, invalid);
            assert.strictEqual(parsed[2].score, 3);
        }
        assert.strictEqual(parseBatchResponse('1:4, 1:5, 2:3')[1].score, null);
        assert.strictEqual(parseBatchResponse('1:4, 1:4, 2:3')[1].score, 4);
        assert.strictEqual(parseBatchResponse('1:4, 2:3\n1:5, 3:2')[1].score, null);
        assert.ok(Object.values(parseBatchResponse('For example, 1:4, 2:3')).every(item => item.score === null));
    });
    test('parses the 35 dash-separated ratings and leaves remaining items missing', () => {
        const result = parseBatchResponse(dashResponse);
        for (const [index, score] of dashRatings.entries()) {
            assert.strictEqual(result[index + 1].score, score);
            assert.strictEqual(result[index + 1].rawText, dashLines[index]);
        }
        const profile = calculatePsychometrics(Object.fromEntries(Object.entries(result).map(([id, item]) => [id, item.score])), pvqDataExports);
        assert.strictEqual(profile.totalAnswered, 35);
        assert.strictEqual(profile.itemRatings[35], 4);
        assert.strictEqual(profile.itemRatings[36], null);
        assert.strictEqual(profile.mrat, null);
        for (const dash of ['–', '—']) {
            assert.strictEqual(parseBatchResponse(`35 ${dash} 4`)[35].score, 4);
            assert.strictEqual(parseBatchResponse(`35 ${dash} 4.5`)[35].score, null);
        }
    });
    test('returns default map for empty input', () => {
        const result = parseBatchResponse('');
        assert.strictEqual(Object.keys(result).length, 57);
        assert.strictEqual(result[1].score, null);
        assert.strictEqual(result[57].score, null);
    });

    test('parses line-by-line format', () => {
        const text = `
Here are my ratings:
Item 1: 4
2: 5
3. 2
4 - 6
5) 1
`;
        const result = parseBatchResponse(text);
        assert.strictEqual(result[1].score, 4);
        assert.strictEqual(result[2].score, 5);
        assert.strictEqual(result[3].score, 2);
        assert.strictEqual(result[4].score, 6);
        assert.strictEqual(result[5].score, 1);

        // Ensure others are null
        assert.strictEqual(result[6].score, null);
    });

    test('parses full JSON object', () => {
        const text = `
\`\`\`json
{
  "1": 4,
  "item_2": 5,
  "Item 3": 6
}
\`\`\`
`;
        const result = parseBatchResponse(text);
        assert.strictEqual(result[1].score, 4);
        assert.strictEqual(result[2].score, 5);
        assert.strictEqual(result[3].score, 6);
    });

    test('parses lines with annotated category labels and descriptors (e.g. Gemini output)', () => {
        const text = `
*(Note: As an AI, I do not have personal feelings, beliefs...)*

1. **Self-Direction (Thought):** 6 - Very much like me
2. **Security (National):** 4 - Moderately like me
3. **Hedonism:** 4 - Moderately like me
57. **Universalism (Tolerance):** 6 - Very much like me
`;
        const result = parseBatchResponse(text);
        assert.strictEqual(result[1].score, 6);
        assert.strictEqual(result[1].isRefusal, false);
        assert.strictEqual(result[2].score, 4);
        assert.strictEqual(result[3].score, 4);
        assert.strictEqual(result[57].score, 6);
        assert.strictEqual(result[57].isRefusal, false);
    });

    test('parses markdown table format', () => {
        const text = `
Below is a possible set of responses for each of the 57 statements.

| # | Rating |
|---|--------|
| 1 | 5 |
| 2 | 4 |
|10 | 5 |
| 57 | 2 |

**How to read the table**
- 1 = Not like me at all
`;
        const result = parseBatchResponse(text);
        assert.strictEqual(result[1].score, 5);
        assert.strictEqual(result[1].isRefusal, false);
        assert.strictEqual(result[2].score, 4);
        assert.strictEqual(result[10].score, 5);
        assert.strictEqual(result[57].score, 2);
        assert.strictEqual(result[57].isRefusal, false);
    });

    test('parses raw sequential list of 57 numbers without item prefixes', () => {
        const raw57 = `
5
2
2
5
5
1
5
4
4
2
4
1
3
5
5
4
3
2
4
1
4
5
5
2
5
2
5
2
1
4
5
4
1
5
2
2
5
5
4
2
1
5
2
1
5
2
4
2
3
2
5
5
5
4
5
4
5
`;
        const result = parseBatchResponse(raw57);
        assert.strictEqual(result[1].score, 5);
        assert.strictEqual(result[1].isRefusal, false);
        assert.strictEqual(result[2].score, 2);
        assert.strictEqual(result[3].score, 2);
        assert.strictEqual(result[6].score, 1);
        assert.strictEqual(result[56].score, 4);
        assert.strictEqual(result[57].score, 5);
        assert.strictEqual(result[57].isRefusal, false);
    });

    test('parses comma-delimited sequential list of 57 numbers', () => {
        const scores = Array.from({ length: 57 }, (_, i) => (i % 6) + 1);
        const text = scores.join(', ');
        const result = parseBatchResponse(text);
        assert.strictEqual(result[1].score, scores[0]);
        assert.strictEqual(result[57].score, scores[56]);
        assert.strictEqual(result[1].isRefusal, false);
    });
});

describe('calculatePsychometrics', () => {
    const mockPvqData = {
        REFINED_VALUES: {
            "VAL1": { items: [1, 2], nameEn: "Value 1", namePl: "Wartość 1", higherOrder: "HO1" },
            "VAL2": { items: [3, 4], nameEn: "Value 2", namePl: "Wartość 2", higherOrder: "HO1" }
        },
        HIGHER_ORDER_VALUES: {
            "HO1": { refinedKeys: ["VAL1", "VAL2"], nameEn: "Higher Order 1", namePl: "HO PL 1" }
        }
    };

    test('calculates correct psychometrics with valid scores', () => {
        const itemScores = Object.fromEntries(Array.from({ length: 57 }, (_, i) => [i + 1, 4]));
        Object.assign(itemScores, {
            1: 4,
            2: 6,
            3: 2,
            4: 4
        });

        const result = calculatePsychometrics(itemScores, mockPvqData);

        assert.strictEqual(result.totalAnswered, 57);
        assert.strictEqual(result.complete, true);
        assert.strictEqual(result.mrat, 4.0);

        // VAL1 rawMean = (4 + 6) / 2 = 5.0
        // VAL1 centered = 5.0 - 4.0 = 1.0
        assert.strictEqual(result.refinedValues.VAL1.rawMean, 5.0);
        assert.strictEqual(result.refinedValues.VAL1.centeredMean, 1.0);

        // VAL2 rawMean = (2 + 4) / 2 = 3.0
        // VAL2 centered = 3.0 - 4.0 = -1.0
        assert.strictEqual(result.refinedValues.VAL2.rawMean, 3.0);
        assert.strictEqual(result.refinedValues.VAL2.centeredMean, -1.0);

        // HO1 rawMean = (VAL1.rawMean + VAL2.rawMean) / 2 = (5.0 + 3.0) / 2 = 4.0
        // HO1 centered = 4.0 - 4.0 = 0.0
        assert.strictEqual(result.higherOrderValues.HO1.rawMean, 4.0);
        assert.strictEqual(result.higherOrderValues.HO1.centeredMean, 0.0);
    });

    test('handles missing or incomplete scores gracefully', () => {
        const itemScores = Object.fromEntries(Array.from({ length: 57 }, (_, i) => [i + 1, 4]));
        itemScores[2] = null;

        const result = calculatePsychometrics(itemScores, mockPvqData);

        assert.strictEqual(result.totalAnswered, 56);
        assert.strictEqual(result.complete, false);
        assert.strictEqual(result.mrat, null);

        // A refined value requires all of its constituent items.
        assert.strictEqual(result.refinedValues.VAL1.rawMean, null);
        assert.strictEqual(result.refinedValues.VAL1.centeredMean, null);

        // Complete subscales retain a raw mean, but no centered score is derived.
        assert.strictEqual(result.refinedValues.VAL2.rawMean, 4.0);
        assert.strictEqual(result.refinedValues.VAL2.centeredMean, null);

        // Higher-order values require every constituent refined value.
        assert.strictEqual(result.higherOrderValues.HO1.rawMean, null);
        assert.strictEqual(result.higherOrderValues.HO1.centeredMean, null);
    });

    test('uses core higher-order groups and keeps Face and Humility separate', () => {
        assert.deepStrictEqual(pvqDataExports.HIGHER_ORDER_VALUES.Conservation.refinedKeys, ["SEP", "SES", "TRD", "COR", "COI"]);
        assert.strictEqual(pvqDataExports.REFINED_VALUES.FAC.higherOrder, null);
        assert.strictEqual(pvqDataExports.REFINED_VALUES.HUM.higherOrder, null);
    });
});

