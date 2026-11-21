/* Runs the translated Python in Pyodide (Python compiled to WebAssembly) inside a Web Worker,
 * so that the page stays responsive and the main thread can stop a program that loops forever.
 *
 * Messages in:  { code: string, inputs: string[] }
 * Messages out: { type: "ready" }
 *               { type: "out", text }            program output (stdout)
 *               { type: "done", result, message } result is "ok" or "error" (a TraceLang runtime error)
 *               { type: "crash", message }       an unexpected Python error
 *               { type: "loading-failed", message }
 */
const PYODIDE_VERSION = "0.26.4";
const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v" + PYODIDE_VERSION + "/full/";

let pyodideReady = null;

function load() {
  if (!pyodideReady) {
    pyodideReady = (async () => {
      importScripts(PYODIDE_BASE + "pyodide.js");
      const py = await loadPyodide({ indexURL: PYODIDE_BASE });
      return py;
    })();
  }
  return pyodideReady;
}

self.onmessage = async (event) => {
  const { code, inputs } = event.data;
  let py;
  try {
    py = await load();
  } catch (err) {
    self.postMessage({ type: "loading-failed", message: String(err && err.message ? err.message : err) });
    return;
  }

  py.setStdout({ batched: (text) => self.postMessage({ type: "out", text: text + "\n" }) });
  py.setStderr({ batched: (text) => self.postMessage({ type: "out", text: text + "\n" }) });

  /* Python is ready: tell the page that the 5 second limit may start now. */
  self.postMessage({ type: "started" });

  try {
    /* The input lines are given to the program before it starts, the same way the native version
       receives them all at once. `code` is the full file: helpers followed by the program. */
    const prelude = "_tl_inputs = " + JSON.stringify(inputs) + "\n";
    await py.runPythonAsync(prelude + code);
    self.postMessage({ type: "done", result: "ok", message: "" });
  } catch (err) {
    const text = String(err && err.message ? err.message : err);
    const m = /_TLError: (.*)/.exec(text);
    const lines = text.split("\n").map((s) => s.trim()).filter((s) => s !== "");
    const last = lines.length ? lines[lines.length - 1] : "";
    if (m && m[1].trim() !== "") {
      self.postMessage({ type: "done", result: "error", message: m[1].trim() });
    } else if (/RecursionError/.test(text)) {
      self.postMessage({ type: "done", result: "error", message: "runtime error: recursion is too deep" });
    } else if (last !== "") {
      /* Any other Python error: show its last line (for example "NameError: ...") so the cause is visible. */
      self.postMessage({ type: "done", result: "error", message: "Python error: " + last });
    } else {
      self.postMessage({ type: "crash", message: text });
    }
  }
};

self.postMessage({ type: "ready" });
