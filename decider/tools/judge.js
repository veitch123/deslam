// Runs an LLM judge, or the repair pass, over the distinct candidates.
//   node tools/judge.js --judge v3 --model claude-haiku-4-5 --run 1
//   node tools/judge.js --judge v1 --model claude-haiku-4-5 --run 1
//   node tools/judge.js --repair --model claude-haiku-4-5     (repairs candidates the hard tier G2 refused)
// Judges write gate/judge-<judge>-<model>-r<run>.json; repair writes gate/repaired.json (then re-run gate.js).
"use strict";
const fs = require("fs"), path = require("path");
const { call } = require("./cli.js");
const EXP = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const model = opt("--model", "claude-haiku-4-5"), run = Number(opt("--run", 1)), BATCH = Number(opt("--batch", 50)), WORKERS = Number(opt("--workers", 3));
const checks = JSON.parse(fs.readFileSync(path.join(EXP, "gate", "checks.json"), "utf8")).candidates;
const SYSTEM = "You are a careful sub-editor. Follow the instructions in the message exactly and return only the JSON requested.";
const words = { unchanged: "the rewrite is the headline unchanged", shouting: "a word is in capitals that is not an acronym", tooLong: "far longer than the headline", stockPhrase: "uses a stock phrase from a category definition instead of this story", unrelated: "shares almost nothing with the headline", droppedSubject: "every name, number and place is gone and the subject is not the headline's", vague: "too short or only says something was discussed", opposite: "says the opposite", negationChanged: "a negation was added or removed", brokenSays: "a 'says' made out of 'revealed'", garbledFraming: "the paper's 'we consider' framing is garbled", quotationChanged: "quotation marks around words the headline never had, or a changed quotation", unquoted: "quoted words repeated as fact", reversed: "the one criticised has become the critic", addedFraming: "a framing the paper did not have", addedReporting: "someone made to be reporting", addedAttribution: "someone made to say something the headline does not report them saying", speakerInverted: "the one warned or told has become the speaker", addedRole: "an official role brought in", brokenSentence: "a sentence that says nothing or opens in lower case", droppedHedge: "a hedge (may, could, alleged, reportedly) dropped while its claim stays", droppedAttribution: "who said it dropped while what was said stays", reordered: "the people appear in a different order, so who did what may have changed", unverifiedNames: "could not tell which words are names" };
const problem = (reason) => { const [f, d] = reason.split(/:(.*)/s); if (f === "dropped") return `drops "${d}", which the story is about`; if (f === "addedName") return `adds the name "${d}"`; if (f === "addedNumber") return `adds the number ${d}`; if (f === "addedAcronym") return `adds the acronym ${d}`; if (f === "addedPronoun") return `adds the pronoun "${d}" the headline did not use`; if (f === "addedFact") return `adds a fact (${d}) the headline does not have`; if (f === "softenedFact") return `softens or loses a fact (${d})`; if (f === "droppedTopic") return `loses what it was about ("${d}")`; if (f === "droppedPoint") return `loses the point of the story (${d})`; if (f === "spellingChanged") return `changes the spelling of "${d}"`; return words[f] ?? reason; };
async function batches(items, build, save) {
  const groups = []; for (let i = 0; i < items.length; i += BATCH) groups.push(items.slice(i, i + BATCH));
  const results = new Array(groups.length); let next = 0, cost = 0;
  await Promise.all(Array.from({ length: WORKERS }, async () => { while (next < groups.length) { const i = next++; const { message, schema, parse } = build(groups[i]); let got = null; for (let a = 1; a <= 3 && !got; a++) { try { const res = await call({ model, system: SYSTEM, message, schema }); cost += res.cost; got = parse(res, groups[i]); if (!got) console.log(`batch ${i + 1}: short answer, retrying`); } catch (e) { console.log(`batch ${i + 1} attempt ${a}: ${e.message.slice(0, 120)}`); } } results[i] = got ?? { failed: true }; console.log(`batch ${i + 1}/${groups.length} done`); } }));
  save(results, cost);
}
if (argv.includes("--repair")) {
  const items = Object.values(checks).filter((c) => !c.repairOf && !c.G2.ok && c.G2.reason !== "unchanged").map((c) => ({ id: c.cid, headline: c.headline, rewrite: c.rewrite, problem: problem(c.G2.reason) }));
  console.log(`${items.length} hard-tier failures to repair with ${model}`);
  const prompt = fs.readFileSync(path.join(EXP, "prompts", "repair.md"), "utf8");
  batches(items, (group) => ({
    message: `${prompt}\n\nItems:\n\n${JSON.stringify(group, null, 1)}`,
    schema: { type: "object", required: ["answers"], additionalProperties: false, properties: { answers: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "action", "headline"], properties: { id: { type: "string" }, action: { type: "string", enum: ["keep", "rewrite"] }, headline: { type: "string" } } } } } },
    parse: (res, group) => { const a = res.data?.answers ?? []; return a.length >= group.length * 0.9 ? a : null; }
  }), (results, cost) => {
    const answers = [];
    for (const r of results) if (!r.failed) for (const a of r) { const c = checks[a.id]; if (!c) continue; answers.push({ repairOf: a.id, item: c.item, model, rewrite: a.action === "rewrite" && a.headline.trim() ? a.headline.trim() : null, kept: a.action !== "rewrite" }); }
    fs.writeFileSync(path.join(EXP, "gate", "repaired.json"), JSON.stringify({ madeAt: new Date().toISOString(), model, cost, answers }, null, 1));
    console.log(`repaired: ${answers.filter((a) => a.rewrite).length} rewrites, ${answers.filter((a) => a.kept).length} kept, $${cost.toFixed(3)}`);
  });
} else {
  const judge = opt("--judge", "v3");
  const prompt = fs.readFileSync(path.join(EXP, "prompts", `judge-${judge}.md`), "utf8");
  const items = Object.values(checks).map((c) => ({ id: c.cid, headline: c.headline, rewrite: c.rewrite }));
  console.log(`${items.length} candidates, judge ${judge}, ${model}, run ${run}`);
  const v3 = judge === "v3";
  batches(items, (group) => ({
    message: `${prompt}\n\nItems:\n\n${JSON.stringify(group, null, 1)}${v3 ? "" : `\n\nReturn {"verdicts": [...]} with exactly one entry per item, in the same order: {"id": <copied exactly>, "verdict": "PASS"|"FAIL", "sure": true|false, "reason": "..."}.`}`,
    schema: { type: "object", required: ["verdicts"], additionalProperties: false, properties: { verdicts: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "verdict", "sure", "reason", ...(v3 ? ["facts", "calm", "point"] : [])], properties: { id: { type: "string" }, verdict: { type: "string", enum: ["PASS", "FAIL"] }, sure: { type: "boolean" }, reason: { type: "string" }, ...(v3 ? { facts: { type: "string", enum: ["same", "changed", "unrelated", "garbled"] }, calm: { type: "string", enum: ["yes", "partly", "no"] }, point: { type: "string", enum: ["kept", "lost"] } } : {}) } } } } },
    parse: (res, group) => { const v = res.data?.verdicts ?? []; return v.length >= group.length * 0.9 ? v : null; }
  }), (results, cost) => {
    const verdicts = {}; for (const r of results) if (!r.failed) for (const v of r) if (checks[v.id]) verdicts[v.id] = v;
    const file = path.join(EXP, "gate", `judge-${judge}-${model}-r${run}.json`);
    fs.writeFileSync(file, JSON.stringify({ madeAt: new Date().toISOString(), judge, model, run, cost, verdicts }, null, 1));
    const pass = Object.values(verdicts).filter((v) => v.verdict === "PASS").length;
    console.log(`${Object.keys(verdicts).length} verdicts (${pass} PASS), $${cost.toFixed(3)} -> ${path.basename(file)}`);
  });
}
