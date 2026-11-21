/* Tests for the translator: every native test program is translated to Python, run with
 * python3, and its output compared with the output of the native compiler (NAME.out).
 * Invalid programs must be rejected with a compile error, valid ones must translate.
 * Run:  node tests/run_tests.js        (needs python3 on the PATH) */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync, spawnSync } = require("child_process");
const TL = require("../tl2py.js");

const here = __dirname;
const PY = process.env.PYTHON || "python3";
let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log("PASS  " + name); };
const bad = (name, why) => { fail++; console.log("FAIL  " + name + ": " + why); };

function runPython(full, inputs) {
  const code = "_tl_inputs = " + JSON.stringify(inputs) + "\n" + full;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tlpy-"));
  const file = path.join(dir, "prog.py");
  fs.writeFileSync(file, code);
  const r = spawnSync(PY, ["-I", file], { encoding: "utf8", timeout: 10000 });
  fs.rmSync(dir, { recursive: true, force: true });
  const err = r.stderr || "";
  if (r.status === 0) return { stdout: r.stdout, status: "ok", message: "" };
  const m = /_TLError: (.*)/.exec(err);
  if (m) return { stdout: r.stdout, status: "error", message: m[1].trim() };
  if (/RecursionError/.test(err)) return { stdout: r.stdout, status: "error", message: "runtime error: recursion is too deep" };
  return { stdout: r.stdout, status: "crash", message: err.trim() };
}

/* 1. Native programs: same output as the native compiler */
const nativeDir = path.join(here, "native");
for (const f of fs.readdirSync(nativeDir).filter((n) => n.endsWith(".tl")).sort()) {
  const name = "native/" + f;
  const src = fs.readFileSync(path.join(nativeDir, f), "utf8");
  const t = TL.translate(src);
  if (!t.ok) { bad(name, `translate error: ${t.error.message} (line ${t.error.line})`); continue; }
  const inFile = path.join(nativeDir, f.replace(/\.tl$/, ".in"));
  const inputs = fs.existsSync(inFile) ? fs.readFileSync(inFile, "utf8").split("\n").filter((l, i, a) => i < a.length - 1 || l !== "") : [];
  const r = runPython(t.full, inputs);
  if (f === "divzero.tl") {
    if (r.status === "error" && /division by zero/.test(r.message)) ok(name + " (runtime error reported)");
    else bad(name, `status=${r.status} message=${r.message}`);
    continue;
  }
  const expected = fs.readFileSync(path.join(nativeDir, f.replace(/\.tl$/, ".out")), "utf8");
  if (r.status !== "ok") bad(name, `runtime status=${r.status}: ${r.message}`);
  else if (r.stdout !== expected) bad(name, `output differs.\n--- expected\n${expected}--- got\n${r.stdout}`);
  else ok(name);
}

/* 2. Valid programs must translate, invalid programs must be rejected */
for (const f of fs.readdirSync(path.join(here, "valid")).filter((n) => n.endsWith(".tl"))) {
  const t = TL.translate(fs.readFileSync(path.join(here, "valid", f), "utf8"));
  t.ok ? ok("valid/" + f) : bad("valid/" + f, t.error.message);
}
for (const f of fs.readdirSync(path.join(here, "invalid")).filter((n) => n.endsWith(".tl"))) {
  const t = TL.translate(fs.readFileSync(path.join(here, "invalid", f), "utf8"));
  if (!t.ok) ok(`invalid/${f} -> ${t.error.category}: ${t.error.message}`);
  else bad("invalid/" + f, "was accepted but should be rejected");
}

console.log(`\nPassed: ${pass}   failed: ${fail}`);
process.exit(fail ? 1 : 0);
