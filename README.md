# Axioma

**Axioma** is a browser-based research tool for generating **PVQ-RR-derived LLM
response profiles** using the Portrait Values Questionnaire, Revised (57 items) by
Shalom H. Schwartz. It is an experimental adaptation: the profiles do not establish
that an LLM possesses human values, and human psychometric validation does not
automatically transfer to language models.

The evaluated LLM answers all 57 PVQ-RR portraits as a survey respondent. Axioma
parses the ratings, computes a profile of **19 refined values**, applies
**grand-mean (MRAT) correction** only to complete 57-item runs, aggregates the
**4 core higher-order value groups**, and reports Face and Humility separately.

100% client-side (vanilla JS, no build step, CORS-safe) — runs from a local file,
static hosting, or any HTTP server.

## Features

- **Full PVQ-RR instrument** — all 57 items in English and Polish, with official
  scale wording (Cieciuch & Schwartz, 2018).
- **Two evaluation modes**
  - *Batch* — all 57 items rated in a single prompt.
  - *Sequential* — item by item, with optional conversation history and a
    shared system prompt across both evaluation modes.
- **Multi-provider API client** — OpenAI, Anthropic, Google Gemini, xAI (Grok),
  Ollama Cloud, and any OpenAI-compatible endpoint. Local OpenAI-compatible
  servers can be configured through Custom Endpoint (default:
  `http://localhost:11434/v1`) with an optional API key.
- **Robust answer parsing** — accepts JSON, bare digits, and "Rating: 5"-style
  text; detects refusals and rejects instructional placeholders or requests for
  the user to supply a rating, even when they contain example scale digits.
  Sequential replies that repeat labeled answers (for example, `Item 1: 5`
  through `Item 4: 4`) or item/rating tables are matched to the current item;
  table ratings take precedence over verbal labels in surrounding prose. Earlier
  answers never fill a missing current answer. The full response remains available
  for inspection.
  Bold Markdown labels and ratings (such as `**Item 10:** 3`) are supported,
  with the original formatting preserved in the saved parsing fragment.
  Numbered lists such as `6. 4`, `6\. 4`, and `6) 4` also match by item ID.
  Dash-separated answers such as `35 – 4` are supported in sequential and batch
  mode, including narrow spaces and portrait text following the rating.
  In sequential mode, an unnumbered list of valid rating rows uses the last row
  when its row count exactly equals the current item number (for example,
  `5`, `2`, `2`, `4` on separate lines gives item 4 a rating of 4). Earlier item
  ratings are preserved; mismatched row counts remain unscored.
  An explicit opening rating on its own line, including `**5**`, takes precedence
  over an AI caveat in the following explanation. Conflicting rating rows and
  instructional placeholders remain unscored.
  A leading rating joined to a capitalized sentence (such as `4It looks...`) is
  recognized; conversational “like me to rate” is not treated as the “Like me” label.
- **Reasoning support** — extracts and stores thinking traces (thinking tags,
  Gemini 3.x thoughts) with a configurable thinking budget.
- **Reproducibility controls** — temperature, seed, fixed or randomized item order.
- **Context interventions** — supply a donor-answer prefix or replace selected
  answers in sequential conversation history, with separate records of actual
  target responses and the answers shown to later requests.
- **Transient-error handling** — automatic retry on HTTP 429 with `Retry-After`
  support, plus cancellable 30-second Fibonacci backoff for HTTP 502, 503, and
  504 provider outages and interrupted or incomplete network responses.
  Temporary failures are retried up to 15 times, with the interval capped at
  five hours (`30s`, `30s`, `60s`, ... `3h 8m 30s`, `5h`).
- **Immediate cancellation** — Stop aborts active provider requests and queued retries.
- **Exports** — JSON, TSV, CSV and multi-sheet XLSX with full run metadata
  (requested/resolved model, system fingerprint, configuration). API exchanges
  preserve each complete query, reasoning trace, and provider response, while
  item results retain the exact fragment used for parsing. Previous session
  CSV/XLSX exports remain importable.
- **Charts** — radar and circle charts of the value profile (Chart.js). These
  charts use zero as a visual origin so that the minimum valid rating remains
  visible; questionnaire ratings themselves remain on the 1–6 scale.
- **Response inspection** — the Items & Responses tab shows each sequential
  API response directly. Batch runs expose one shared full response alongside
  per-item parsing fragments and an explicit parsing summary.
- **Security** — DOMPurify-sanitized rendering of model output; API keys remain
  session-only by default, while system-prompt edits reset on reload (see
  [Security notes](#security-notes)).

## Repository structure

| Path | Purpose |

|---|---|
| `index.html` | Entry point; loads locally vendored browser dependencies |
| `js/pvq_data.js` | 57 PVQ-RR items (EN/PL) and mappings to the 19 values |
| `js/api_client.js` | Multi-provider LLM client, retries, reasoning extraction |
| `js/execution_engine.js` | Batch vs. sequential evaluation, ordering, progress |
| `js/context_intervention.js` | Experiment validation, donor snapshots, and supplied history |
| `js/psychometrics.js` | Scoring: 19 value means, MRAT correction, higher-order groups, refusal detection |
| `js/export.js` | JSON/TSV/CSV/XLSX export and session import |
| `js/app.js` | UI, charts, persistence |
| `js/version.js` | Central version constant |
| `js/tests/` | Unit tests (`node:test`) |

## Getting started

1. Clone or download this repository.
2. Open `index.html` in a modern browser (no server or build step required).
3. Pick a provider, paste an API key when required, and load or type a model
   name. Custom Endpoint accepts an optional API key.
4. Choose the evaluation mode, temperature, seed and item order.
5. Press **Start** — live progress, charts and export options appear as the run completes.

## Reparse saved answers

Loading a session CSV or XLSX retains its saved item ratings and recalculates the
profile from those ratings. To apply the current answer parser to older results,
open **Results** and click **Reparse answers** next to the iteration selector.
This reparses all runs in the current session from saved raw responses, updates
ratings and parsing fragments, and recalculates their profiles without API calls.
The status message reports how many answers were reparsed and ratings changed.
**Undo reparse** restores the session before the last reparse; this undo is cleared
when starting an evaluation, loading a file, or starting a new session.

Missing, truncated, or ambiguous raw response records retain their saved ratings;
they are reported as retained items. A complete response that the parser cannot
interpret becomes unscored. Batch runs require the complete batch response, not
per-item parsing fragments. Sequential responses are matched by item ID.
Supplied intervention answers and original conversation history are preserved;
target ratings and the separate combined profile are recalculated. Donor snapshots
remain as recorded. Existing files are never overwritten by the reparse action.

Save the session again to export corrected results. CSV and XLSX retain the
reprocessing time, parser application version, original ratings, and affected
item IDs in the existing chunked records, as does JSON. The original run version
and model metadata remain unchanged. Reloading retains the corrected scores;
reparsing always requires the explicit action.

## Context interventions

In **Sequential Mode**, choose a **Context intervention** in the evaluation
settings. The **Setup** workspace keeps endpoint and execution settings side by side on desktop and stacked on mobile. Reasoning and system-prompt controls are under collapsed **Advanced settings**. **Edit injections** opens a dialog (full-screen on mobile); the setup panel shows a compact summary of selected values. Changes apply immediately and survive closing the editor or switching views. The separate **Results** workspace contains profile, responses, and output tabs, with numerical tables under **Show score details**. Setup/Results navigation and Start/Stop controls sit directly below the header and stay at the top while scrolling. Starting an evaluation or loading a session opens Results automatically. Provider, model, prompt, and generation controls remain shared.

- **None (baseline):** ordinary evaluation. Enable history and disable
  randomization to create a baseline for matched experiment comparisons.
- **Supplied prefix:** select a donor run from the session or import donor runs
  from a session CSV/XLSX without replacing the current session. Choose 1–56
  answers (default 19), review their item IDs and value mappings, and optionally
  edit ratings. Axioma inserts numeric answers to items 1–N as assistant history,
  then asks the target model items N+1–57. Donor reasoning is not replayed.
- **History injection (skip selected questions):** select ratings by value (such
  as POR or POD) or by individual item. Selected questions make no model request.
  Their question/answer pairs enter history at the normal position; later model
  requests see those supplied answers. Select up to 56 items, including item 57.
  Leave at least one item for the model. The final profile combines supplied and
  target answers, with target-only scores persisted separately.

Older **History replacement** results remain readable with their original
ask-then-replace behavior. New runs use the distinct `supplied` condition, so
skipped questions cannot be confused with actual model responses.

Interventions lock history on and question order to 1–57. Ordinary-run history
and randomization preferences are restored when the intervention is disabled.
The provider seed does not control question shuffling. Donor ratings are matched
by item ID; randomized or unknown donor order is reported rather than treated as
a replay of the original conversation. Donor and target questionnaire languages
must match. Missing donor ratings require an explicit correction or shorter
prefix; no ratings are imputed.

Use **Preview conversation** to inspect the supplied context and remaining order.
When comparing separate runs, align question order, model, language, prompt, and
generation settings. Each Start snapshots the configuration for all iterations;
each iteration starts with fresh history and receives its own run ID.

Selecting a donor shows a compact preview of its original 19-value profile.
New prefix runs save a snapshot of that donor profile, so the preview stays with
the result after export/import or changing the selected donor. Earlier results
can use their donor run from the loaded session when its run ID is available.
The preview uses the donor's saved means and does not include manual prefix edits.

Completed prefix runs show **Donor profile** and **Final profile (supplied + target)**
using the same profile view as normal runs: higher-order and 19-value radars, full labels, raw and centered scores, and click-to-enlarge controls. Shared checkboxes in the main view and both enlarged charts show either or both profiles; visibility stays synchronized. Summary cards and tables describe the final (supplied + target) profile; target-only response count and MRAT remain explicitly identified. The final profile combines the edited
supplied prefix with actual target continuation, using the existing scoring
formulas. It is descriptive of the combined sequence, not exclusively the target
model's answers. Its scores are persisted separately as `combinedPsychometrics`
in JSON and the chunked TSV/CSV/XLSX experiment records. Importing earlier prefix
sessions reconstructs this separate profile from their recorded prefix and target
ratings. Missing continuation ratings are never filled from the donor.

**Target-only scores remain separate.** A 19-answer prefix makes 38 target
requests; those target-only results have no MRAT or centered scores. Supplied
answers do not count as target ratings or API exchanges. History replacement
preserves the original ratings for scoring. Items & Responses labels
supplied answers and displays replacements separately from actual raw responses.
Questionnaire wording, mappings, and scoring formulas are unchanged.

JSON and TSV include experiment records. CSV/XLSX add provenance fields and
chunked experiment records, preserving the exact supplied answers, source
metadata, donor-run references, resolved system prompt, and item order on session
export/import. XLSX stores these chunks in **Experiment Records** to avoid
truncating experiment evidence at Excel's cell limit. Existing response/query
display cells may still be truncated in XLSX. Earlier session files remain
importable; missing source order and identifiers remain unknown. No new
prediction or statistical comparison metrics are calculated.

Stop cancels the active request and queued retries. Completed iterations remain
in the session; an interrupted iteration is not saved as a completed result.

## Testing

```bash
node --test js/tests/              # main unit-test suite (no dependencies)
node tests/psychometrics.test.js   # legacy standalone parser tests
```

CI (GitHub Actions) runs the suite on Node 22 and 24 for every push to `main`
and every pull request.

## Releases

Merging a pull request that updates `js/version.js` automatically creates a
matching GitHub Release and `vX.Y.Z` tag. Release notes are generated from the
merged pull requests and grouped using `.github/release.yml` labels. Existing
releases and tags are never overwritten by the workflow.

## Security notes

- API keys are sent directly from the browser to the chosen provider and remain
  in memory by default. Persistent storage is an explicit opt-in.
- Remembered keys use light XOR+Base64 obfuscation in `localStorage`. This deters
  casual inspection but **is not encryption**; a browser extension or XSS can
  still recover them. Disabling the option removes all remembered provider keys.
- Model output is rendered through DOMPurify.
- Browser libraries are pinned and stored locally, and a Content Security Policy
  prevents execution of scripts from third-party origins. Internet access is
  needed only for provider API calls.
- Spreadsheet imports are limited to 25 MB. SheetJS is kept on a release that
  includes the published prototype-pollution and ReDoS fixes.
- CSV and TSV exports neutralize formula-like cells before spreadsheet software
  can evaluate them.
- Do not commit session result files that contain sensitive data.

## References

- Schwartz, S. H., et al. (2012). *Refining the theory of basic individual values.* JPSP.
- Cieciuch, J., & Schwartz, S. H. (2018). *Pomiar wartości.*
- Schwartz, S. H., & Cieciuch, J. (2021). [PVQ-RR questionnaires and scoring
  resources](https://osf.io/w9as3/files/osfstorage?view_only=e1f02bf232c34d39b9884398b4f2df63).
  Axioma's male-form item wording and instructions are based on the repository's
  [English questionnaire](https://osf.io/download/qv39m/?view_only=e1f02bf232c34d39b9884398b4f2df63)
  and [Polish questionnaire](https://osf.io/download/26w7h/?view_only=e1f02bf232c34d39b9884398b4f2df63).
  The paper-form instruction to mark a response box is adapted to request a
  corresponding numeric response from the evaluated model.

## License

[MIT](LICENSE)

The supplied-answer mode supports **Inject by value**: selecting 6 for POR or POD supplies 6 for every related question. Individual edits appear as mixed settings. Selecting **Ask the model** clears that value?s supplied ratings.

History injection highlights affected value axes with orange labels, asterisks, and diamond markers on both normal and enlarged charts. Tooltips and the visible injection key list exact item IDs and supplied ratings from the saved experiment. Higher-order axes are marked when their constituent values contain injected items; unchanged axes retain their normal styling. The stored condition remains `supplied` for export compatibility.
