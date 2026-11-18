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

describe('parseItemResponse', () => {
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

