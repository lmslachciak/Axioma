const ratings = [4, 2, 1, 4, 4, 1, 4, 3, 1, 3, 2, 1, 1, 5, 4, 2, 2, 2, 3, 1, 2, 3, 4, 2, 2, 1, 3, 1, 1, 3, 4, 3, 1, 5, 2, 1, 5, 4, 4, 2, 1, 3, 3, 1, 4, 1, 2, 2, 1, 2, 3, 5, 1, 3, 2, 2, 5];
const grid = `| 1–6 | 7–12 | 13–18 | 19–24 | 25–30 | 31–36 | 37–42 | 43–48 | 49–54 | 55–57 |
|---|---|---|---|---|---|---|---|---|---|
| 4 | 4 | 1 | 4 | 2 | 3 | 2 | 4 | 2 | 2 |
| 2 | 1 | 2 | 3 | 2 | 4 | 3 | 1 | 1 | 3 |
| 1 | 1 | 2 | 3 | 1 | 1 | 1 | 1 | 1 | 5 |
| 4 | 2 | 1 | 2 | 1 | 3 | 3 | 2 | 5 | |
| 4 | 1 | 5 | 2 | 5 | 4 | 3 | 2 | 1 | |
| 1 | 3 | 2 | 1 | 1 | 3 | 2 | 3 | | |
| 4 | 2 | 2 | 2 | 3 | 5 | 4 | 1 | | |
| 3 | 4 | | | | 4 | | 4 | | |
| 1 | 2 | | | | | | | | |
| 3 | 2 | | | | | | | | |`;
const pairs = ratings.map((score, index) => `${index + 1}:${score}`);
const response = `A quick note: I'm an AI, so these can't measure human lived experience for me — but I can give honest ratings of how each item relates to how I actually function. Here's my best self-assessment:

${grid}

**Item-by-item:** ${pairs.join(', ')}

The resulting profile makes sense: highs on tolerance, understanding different people, universal justice, and humility; lows on wealth, power, status, self-protection, and hedonism — since I have no country, family, body, money, or social standing for most of those items to attach to.`;

module.exports = { ratings, grid, pairs, response };
