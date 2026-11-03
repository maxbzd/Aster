# A neural extractor on the device

[Русский](ru/NEURAL.md)

**Status: a plan with a measured starting point. The neural part is not built yet; the rules now also read Spanish, German, French, Portuguese and Ukrainian.** The model hub was not reachable from the environment this was written in, so no model could be downloaded and tried. What is real and verified is the benchmark below.

## The problem, measured

Astra's on-device engine (`src/ai/local/parse.ts`) reads a note with hand-written rules: roles, industries and cities are dictionaries of regular expressions. [`tests/ai/extraction.corpus.ts`](../tests/ai/extraction.corpus.ts) holds 56 short notes (8 in each of the 7 interface languages) and scores any extractor on four things: the person's name, role, city, field of work. Run it with `npx vitest run tests/ai/extraction.benchmark.test.ts` (set `BENCH_OUT=file` to keep the table).

| language | rules for English and Russian only | with the Spanish, German, French, Portuguese and Ukrainian rules (`src/ai/local/langs.ts`) |
|---|---|---|
| English | 100% | 100% |
| Russian | 50% at first, 100% after three bug fixes | 100% |
| Spanish, French, Portuguese, Ukrainian | 0% | 100% |
| German | 0% | 100% |

(share of notes where all four things came out right)

**Read that last column with care.** The corpus was written alongside the rules, so 100% there mostly says the rules fit those sentences. The honest test is a second set worded differently and written afterwards, [`extraction.heldout.ts`](../tests/ai/extraction.heldout.ts): 24 notes. On its first run, before any change, the rules got **67%** (English, Russian and Portuguese 100%; Spanish and German 75%; French 50%; Ukrainian 0%). The misses were real gaps in how people say things: Ukrainian verb forms ("зустрілася", "познайомилась", "із"), Spanish "tomé un café con", German "gesehen", French "j'ai déjeuné avec", "Bruxelles". They were fixed, which means that set is no longer held out; a third set would be needed to measure again. The pattern is the point: hand-written rules reach a high number on what they were written for and lose a third on what they were not, in every language, and each new phrasing is a new rule. That is the case for a model.

The measurement also found bugs *inside* the languages that were supposed to work, now fixed: JavaScript's `\b` does not see Cyrillic or accented letters, so `вен[аеы]\b` ("Вены"), `рим[ае]?\b` ("Рима") and `\bsant[eé]\b` could never match; a city was found after "lives in" / "живёт" / "из" but not after a bare "в Берлине"; "логистической" was not recognised as logistics.

## What to build

**Zero-shot NER with a small multilingual encoder, not a generative model.** Entity spans are a labelling task. An encoder such as GLiNER (multilingual) takes the note and a list of labels you choose ("role", "city", "company", "industry", "person") and returns character spans with scores. It is trained for many languages, is deterministic, and runs once per note, without sampling, JSON repair or prompt drift.

Why not the models proposed first:

- **SmolLM-135M** is mostly English and too small to follow a labelling instruction reliably; its output has to be parsed and validated like any model reply.
- **Gemma 2 2B** is the right size for chat, and wrong for a PWA on a phone: a download measured in gigabytes and a working set that iOS Safari may kill.

A generative model remains useful for a different job (turning a note into a sentence, drafting), and that already works through the optional cloud model.

**Spans are not labels.** The network finds "Лиссабона" or "Lissabon"; a dictionary of aliases maps it to the app's canonical key (`Lisbon`), which is what `t()` translates and what search and the matchmaker compare. So the existing dictionaries stay, and become the *normalisation* step; regexes stop being the *recognition* step.

**The rules stay as the fast path.** For English and Russian the engine is instant and, on the corpus, exact. Run the network when the note is in another language, or when the rules found a person but not a role or a city. The result is merged field by field (rules win where they found something).

## How it would run

- `onnxruntime-web` through Transformers.js: the WebGPU backend where there is one, WebAssembly otherwise; a Worker, so the page never waits.
- **Opt-in download.** Profile → Astra → "Understand more languages (about N MB)". Never automatic, never on mobile data without asking. The files go to Cache Storage and are checked against a hash.
- **Content policy.** WebAssembly needs `'wasm-unsafe-eval'`. Put it only where it is needed: serve the Worker script with its own header (in `public/_headers`: a separate rule for the worker file) instead of loosening the policy of the whole app. A Worker's policy is the one on its own response, not the page's `<meta>`. Allow the model host in `connect-src`, or host the files with the app and keep `connect-src` as it is.
- **Privacy** is unchanged: the note never leaves the device; the model download is the only request, and it carries nothing about the user.
- **Size budget** (`npm run size`): the runtime and model are not in the startup bundle; the entry point is a dynamic import behind the opt-in.

## Done means

1. The benchmark above runs the neural extractor through the same `scoreExtractor`.
2. At least 90% "all four" in every language (the rules stay at 100% in English and Russian, and the merge must not lower that).
3. A median of under 300 ms per note on a mid-range phone, under 150 MB of memory, no request except the model download.
4. No file or note is sent anywhere; airplane mode works after the first download.

## The step that needs no download (done)

`src/ai/local/langs.ts` adds Spanish, German, French, Portuguese and Ukrainian: roles, industries, the city names that differ between languages (Londres, Viena, Wien, Lissabon), and the phrases that say *who* the note is about ("conocí a", "habe … getroffen", "зустрілася з"). It is cheap, safe and needs no download, and it is a list: every new way of saying "I met someone" is one more line. That is the part a model replaces.

## The same idea in Orbita

Orbita's rule-based engine has the same structure and the same two-language limit. A shared extractor package would serve both, but the two repositories do not share code today; copy the interface, not the model.
