/* webCompiler: a TraceLang editor that translates programs to Python and runs them in the browser.
 * The translator is window.TraceLang (tl2py.js), the sample programs are window.WC_SAMPLES (samples.js),
 * and programs run in a Web Worker (worker.js) with Pyodide. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const KEY = { draft: "wc-draft", programs: "wc-programs", font: "wc-font-size", theme: "wc-theme" };
  const FONT_DEFAULT = 13.5;
  const PROG_MAX = 50;
  const PROG_CHARS = 64 * 1024;
  const RUN_LIMIT_MS = 5000;
  const KEYWORDS = new Set(["start", "end", "show", "write", "if", "elif", "else", "while", "for", "in", "to",
    "function", "return", "and", "or", "not"]);
  const TYPES = new Set(["int", "float", "string", "bool"]);

  const TL = window.TraceLang;
  const SAMPLES = window.WC_SAMPLES || [];

  const els = {
    src: $("src"), hl: $("hl"), gutter: $("gutter"), cursor: $("cursor-info"),
    sampleSel: $("sample"), sampleInfo: $("sample-info"),
    compile: $("btn-compile"), run: $("btn-run"), stop: $("btn-stop"), theme: $("btn-theme"),
    pyOut: $("py-out"), pyInfo: $("py-info"), copyPy: $("btn-copy-py"), dlPy: $("btn-dl-py"),
    pyRun: $("py-run"), pyRunOut: $("py-run-out"),
    consoleOut: $("console-out"), stdin: $("stdin"), termOut: $("term-out"),
    status: $("status"), statusInfo: $("status-info"),
    workbench: $("workbench"), splitter: $("splitter"),
    side: $("side"), scrim: $("side-scrim"), btnSide: $("btn-side"),
    progForm: $("prog-form"), progName: $("prog-name"), progList: $("prog-list"), progCount: $("prog-count"),
    progImport: $("prog-import"), setFont: $("set-font"), setFontVal: $("set-font-val"),
    fontPreview: $("font-preview"), setReset: $("set-reset"),
    help: $("help-dialog"), btnHelp: $("btn-help"), toasts: $("toasts"),
  };

  /* ---------------------------------------------------------- storage (safe) */

  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (_) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, value); } catch (_) { /* private mode or full: ignore */ }
  }

  /* ----------------------------------------------------------- small helpers */

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function toast(message, kind = "ok") {
    const t = document.createElement("div");
    t.className = "toast " + kind;
    t.textContent = message;
    els.toasts.appendChild(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 320); }, 2600);
  }

  function setStatus(kind, text, info) {
    els.status.className = "status" + (kind ? " " + kind : "");
    els.status.textContent = text;
    if (info !== undefined) els.statusInfo.textContent = info;
  }

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ----------------------------------------------------------------- editor */

  let errorLine = 0;
  let draftTimer = null;

  function highlightLine(line) {
    const re = /(#.*$)|("(?:\\.|[^"\\])*"?)|(\d+(?:\.\d+)?)|([A-Za-z_]\w*)|(==|!=|<=|>=|->)|([()<>=+\-*/%:,])|([\s\S])/g;
    let out = "", m;
    while ((m = re.exec(line))) {
      const text = escapeHtml(m[0]);
      if (m[1]) out += `<span class="hl-com">${text}</span>`;
      else if (m[2]) out += `<span class="hl-str">${text}</span>`;
      else if (m[3]) out += `<span class="hl-num">${text}</span>`;
      else if (m[4]) {
        const w = m[4];
        let cls = "hl-id";
        if (KEYWORDS.has(w)) cls = "hl-kw";
        else if (TYPES.has(w)) cls = "hl-type";
        else if (w === "true" || w === "false") cls = "hl-num";
        out += `<span class="${cls}">${text}</span>`;
      } else if (m[5] || m[6]) out += `<span class="hl-op">${text}</span>`;
      else out += text;
    }
    return out;
  }

  function renderEditor() {
    const lines = els.src.value.split("\n");
    const cur = currentLine();
    els.gutter.innerHTML = lines.map((_, i) =>
      `<div class="gl${i + 1 === errorLine ? " err" : ""}${i === cur ? " cur" : ""}">${i + 1}</div>`).join("");
    els.hl.innerHTML = lines.map((l, i) =>
      `<div class="hl-l${i === cur ? " active" : ""}${i + 1 === errorLine ? " hl-err" : ""}"><span>${highlightLine(l) || "&#8203;"}</span></div>`).join("");
    els.hl.scrollTop = els.src.scrollTop;
    els.hl.scrollLeft = els.src.scrollLeft;
    els.gutter.scrollTop = els.src.scrollTop;
    updateCursorInfo();
  }

  function currentLine() {
    const pos = els.src.selectionStart || 0;
    return els.src.value.slice(0, pos).split("\n").length - 1;
  }

  function updateCursorInfo() {
    const pos = els.src.selectionStart || 0;
    const before = els.src.value.slice(0, pos).split("\n");
    els.cursor.textContent = `Ln ${before.length}, Col ${before[before.length - 1].length + 1}`;
  }

  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => save(KEY.draft, els.src.value), 300);
  }

  function insertAtCursor(text) {
    els.src.focus();
    const s = els.src.selectionStart, e = els.src.selectionEnd;
    els.src.setRangeText(text, s, e, "end");
    els.src.dispatchEvent(new Event("input"));
  }

  function setSource(text) {
    els.src.value = text;
    errorLine = 0;
    renderEditor();
    scheduleDraft();
  }

  els.src.addEventListener("input", () => {
    renderEditor();
    scheduleDraft();
  });
  els.src.addEventListener("scroll", () => {
    els.hl.scrollTop = els.src.scrollTop;
    els.hl.scrollLeft = els.src.scrollLeft;
    els.gutter.scrollTop = els.src.scrollTop;
  });
  ["keyup", "click", "select"].forEach((ev) => els.src.addEventListener(ev, () => renderEditor()));

  els.src.addEventListener("keydown", (ev) => {
    if (ev.key === "Tab" && !ev.ctrlKey && !ev.metaKey) {
      ev.preventDefault();
      insertAtCursor("    ");
    } else if (ev.key === "Enter" && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
      /* Keep the indentation of the line; add one level after a line that ends with ':' */
      ev.preventDefault();
      const pos = els.src.selectionStart;
      const lineStart = els.src.value.lastIndexOf("\n", pos - 1) + 1;
      const before = els.src.value.slice(lineStart, pos);
      const indent = /^ */.exec(before)[0];
      const extra = before.trimEnd().endsWith(":") ? "    " : "";
      insertAtCursor("\n" + indent + extra);
    }
  });

  /* ------------------------------------------------------------ translation */

  let lastPython = "";
  let lastFull = "";

  function showConsole(entries) {
    els.consoleOut.innerHTML = "";
    for (const e of entries) {
      const d = document.createElement("div");
      d.className = "console-line " + (e.kind || "info");
      const title = document.createElement("div");
      title.className = "console-title";
      title.textContent = e.title;
      d.appendChild(title);
      if (e.body) {
        const b = document.createElement("div");
        b.className = "console-body";
        b.textContent = e.body;
        d.appendChild(b);
      }
      els.consoleOut.appendChild(d);
    }
  }

  function switchTab(name) {
    $$(".output-pane .tab").forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    $$(".output-pane .panel").forEach((p) => p.classList.toggle("active", p.id === "p-" + name));
  }

  /* Translates the source. Returns the Python code, or null after showing the error. */
  function compile() {
    const r = TL.translate(els.src.value);
    if (!r.ok) {
      const e = r.error;
      errorLine = e.line;
      renderEditor();
      lastPython = "";
      lastFull = "";
      els.pyOut.textContent = "";
      els.pyInfo.textContent = "Fix the error to see the Python code.";
      showConsole([{
        kind: "err",
        title: `${e.category} error on line ${e.line}, column ${e.col}`,
        body: `${e.message}${e.fix ? "\nFix: " + e.fix : ""}`,
      }]);
      switchTab("console");
      setStatus("err", `${e.category} error`, `Line ${e.line}: ${e.message}`);
      return null;
    }
    errorLine = 0;
    renderEditor();
    lastPython = r.python;
    lastFull = r.full;
    els.pyOut.textContent = r.python;
    const lines = r.python.split("\n").length;
    els.pyInfo.textContent = `Python code, ${lines} lines. Generated from your TraceLang program.`;
    showConsole([{ kind: "ok", title: "Translated to Python", body: "No errors found." }]);
    switchTab("python");
    setStatus("ok", "Compiled OK", "The Python code is ready. Press Run to execute it.");
    return r;
  }

  /* ------------------------------------------------------------------ running */

  let worker = null;
  let activeRun = null;

  function getWorker() {
    if (!worker) {
      worker = new Worker("worker.js");
      worker.onmessage = onWorkerMessage;
      worker.onerror = (ev) => finishRun("crash", "Could not start the Python worker: " + (ev.message || "unknown error"));
    }
    return worker;
  }

  function stopWorker() {
    if (worker) worker.terminate();
    worker = null;
  }

  function stdinLines() {
    const text = els.stdin.value.replace(/\r/g, "");
    const lines = text.split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    return lines;
  }

  function termBegin(inputs) {
    els.termOut.innerHTML = "";
    if (inputs.length) {
      const block = document.createElement("div");
      block.className = "term-block";
      block.innerHTML = `<div class="term-label">Input sent</div>`;
      const pre = document.createElement("pre");
      pre.className = "term-in";
      pre.textContent = inputs.join("\n");
      block.appendChild(pre);
      els.termOut.appendChild(block);
    }
    const out = document.createElement("div");
    out.className = "term-block";
    out.innerHTML = `<div class="term-label">Output</div>`;
    const pre = document.createElement("pre");
    pre.className = "term-out";
    out.appendChild(pre);
    els.termOut.appendChild(out);
    return pre;
  }

  function termVerdict(text, kind) {
    const v = document.createElement("div");
    v.className = "term-verdict " + kind;
    v.textContent = text;
    els.termOut.appendChild(v);
    els.termOut.scrollTop = els.termOut.scrollHeight;
    /* The same message also shows under the Python code. */
    els.pyRunOut.textContent += "\n[" + text + "]\n";
  }

  function setBusy(on) {
    els.run.hidden = on;
    els.stop.hidden = !on;
    els.compile.disabled = on;
    if (on) setStatus("busy", "Running…", "The program runs in the browser. It stops after 5 seconds.");
  }

  function finishRun(kind, text) {
    if (!activeRun) return;
    clearTimeout(activeRun.timer);
    activeRun = null;
    setBusy(false);
    if (kind === "ok") {
      termVerdict("Program finished.", "ok");
      setStatus("ok", "Finished", "Program finished without errors.");
    } else if (kind === "error") {
      termVerdict(text, "err");
      setStatus("err", "Runtime error", text);
    } else if (kind === "limit") {
      termVerdict("Stopped: the program ran longer than 5 seconds. The output above is what it printed before it was stopped. Check for a loop that never ends.", "warn");
      setStatus("err", "Stopped", "The program ran longer than 5 seconds.");
    } else if (kind === "stopped") {
      termVerdict("Stopped by you.", "warn");
      setStatus("", "Stopped", "");
    } else if (kind === "loading") {
      termVerdict(text, "err");
      setStatus("err", "Python did not load", text);
    } else {
      termVerdict(text, "err");
      setStatus("err", "Error", text);
    }
  }

  function onWorkerMessage(ev) {
    const msg = ev.data;
    if (!activeRun) return;
    if (msg.type === "started") {
      activeRun.timer = setTimeout(() => {
        if (!activeRun) return;
        stopWorker();
        finishRun("limit");
      }, RUN_LIMIT_MS);
    } else if (msg.type === "out") {
      activeRun.pre.textContent += msg.text;
      els.pyRunOut.textContent += msg.text;
      els.termOut.scrollTop = els.termOut.scrollHeight;
    } else if (msg.type === "done") {
      if (msg.result === "ok") finishRun("ok");
      else finishRun("error", "Runtime error: " + msg.message.replace(/^runtime error: /, ""));
    } else if (msg.type === "crash") {
      stopWorker();
      finishRun("crash", "Unexpected error: " + msg.message);
    } else if (msg.type === "loading-failed") {
      stopWorker();
      finishRun("loading", "Python could not be loaded. The first run needs internet access. Check the connection and try again.");
    }
  }

  function run() {
    if (activeRun) return;
    const translated = compile();
    if (translated === null) return;
    const inputs = stdinLines();
    const pre = termBegin(inputs);
    els.pyRun.hidden = false;
    els.pyRunOut.textContent = "";
    switchTab("terminal");
    setBusy(true);
    /* The 5 second limit starts when the program starts (see "started"), not while Pyodide loads. */
    activeRun = { pre, timer: null };
    getWorker().postMessage({ code: translated.full, inputs });
  }

  function stopRun() {
    if (!activeRun) return;
    stopWorker();
    finishRun("stopped");
  }

  /* ------------------------------------------------------- samples and copies */

  function loadSampleOptions() {
    SAMPLES.forEach((s, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = s.name;
      els.sampleSel.appendChild(o);
    });
  }

  els.sampleSel.addEventListener("change", () => {
    const s = SAMPLES[Number(els.sampleSel.value)];
    if (!s) return;
    const current = els.src.value.trim();
    if (current && current !== s.source.trim()) {
      addProgram("Before " + s.name, els.src.value);
    }
    setSource(s.source);
    els.sampleInfo.textContent = s.description;
    compile();
    els.sampleSel.value = "";
    toast("Sample loaded. Your earlier text was saved in Saved programs.", "ok");
  });

  els.copyPy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(lastPython);
      toast("Python code copied.", "ok");
    } catch (_) {
      toast("Could not copy. Select the code and copy it.", "warn");
    }
  });
  els.dlPy.addEventListener("click", () => {
    if (!lastFull) { toast("Compile the program first.", "warn"); return; }
    download("program.py", lastFull, "text/x-python");
  });

  /* ---------------------------------------------------------- saved programs */

  function readPrograms() {
    try {
      const list = JSON.parse(load(KEY.programs, "[]"));
      return Array.isArray(list) ? list.filter((p) => p && typeof p.source === "string") : [];
    } catch (_) { return []; }
  }
  function writePrograms(list) {
    save(KEY.programs, JSON.stringify(list));
  }

  function addProgram(name, source) {
    if (source.length > PROG_CHARS) { toast("This program is too large to save.", "err"); return false; }
    const list = readPrograms();
    list.unshift({ id: Date.now() + Math.random().toString(36).slice(2, 7), name, source, saved: Date.now() });
    writePrograms(list.slice(0, PROG_MAX));
    renderPrograms();
    return true;
  }

  function saveProgram() {
    const name = els.progName.value.trim() || `Program ${readPrograms().length + 1}`;
    if (addProgram(name, els.src.value)) {
      els.progName.value = "";
      toast(`Saved "${name}".`, "ok");
    }
  }

  function renderPrograms() {
    const list = readPrograms();
    els.progList.innerHTML = "";
    els.progCount.textContent = list.length ? `${list.length} saved` : "";
    if (!list.length) {
      const li = document.createElement("li");
      li.className = "prog-empty muted small";
      li.textContent = "No saved programs yet. Name a program above and press Save (Ctrl+S).";
      els.progList.appendChild(li);
      return;
    }
    list.forEach((p, i) => {
      const li = document.createElement("li");
      li.className = "prog-item";
      li.style.animationDelay = Math.min(i, 10) * 0.03 + "s";
      const info = document.createElement("div");
      info.className = "prog-info";
      const n = document.createElement("div");
      n.className = "prog-name";
      n.textContent = p.name;
      const d = document.createElement("div");
      d.className = "prog-date muted small";
      d.textContent = new Date(p.saved).toLocaleString();
      info.append(n, d);
      const actions = document.createElement("div");
      actions.className = "prog-actions";
      actions.append(
        button("Open", () => openProgram(p.id)),
        button("Export", () => download((p.name.replace(/[^\w-]+/g, "_") || "program") + ".tl", p.source, "text/plain")),
        button("Delete", () => deleteProgram(p.id), "danger"),
      );
      li.append(info, actions);
      els.progList.appendChild(li);
    });
  }

  function button(label, onClick, extra) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-mini" + (extra ? " " + extra : "");
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  function openProgram(id) {
    const p = readPrograms().find((x) => x.id === id);
    if (!p) return;
    setSource(p.source);
    compile();
    setSide(false);
    toast(`Opened "${p.name}".`, "ok");
  }

  function deleteProgram(id) {
    const list = readPrograms();
    const p = list.find((x) => x.id === id);
    if (!p || !window.confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    writePrograms(list.filter((x) => x.id !== id));
    renderPrograms();
    toast("Program deleted.", "ok");
  }

  els.progForm.addEventListener("submit", (ev) => { ev.preventDefault(); saveProgram(); });

  els.progImport.addEventListener("change", async () => {
    const file = els.progImport.files && els.progImport.files[0];
    els.progImport.value = "";
    if (!file) return;
    if (file.size > PROG_CHARS) { toast("This file is too large.", "err"); return; }
    const text = await file.text();
    const name = file.name.replace(/\.tl$/i, "");
    if (addProgram(name, text)) toast(`Imported "${name}".`, "ok");
  });

  /* ------------------------------------------------------------ side panel */

  function sideOpen() { return els.side.classList.contains("open"); }

  function setSide(open, tab) {
    els.side.classList.toggle("open", open);
    els.scrim.hidden = !open || window.innerWidth > 920;
    els.btnSide.setAttribute("aria-expanded", open ? "true" : "false");
    if (open && tab) showSideTab(tab);
    if (open) setTimeout(() => (tab === "settings" ? els.setFont : els.progName).focus(), 60);
  }

  function showSideTab(name) {
    $$(".side-tab").forEach((t) => {
      const on = t.dataset.side === name;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    $("side-programs").hidden = name !== "programs";
    $("side-settings").hidden = name !== "settings";
  }

  $$(".side-tab").forEach((t) => t.addEventListener("click", () => showSideTab(t.dataset.side)));
  els.btnSide.addEventListener("click", () => setSide(!sideOpen()));
  $("side-close").addEventListener("click", () => setSide(false));
  els.scrim.addEventListener("click", () => setSide(false));

  /* ----------------------------------------------------------------- settings */

  function applyFont(v) {
    const n = Math.min(18, Math.max(12, Number(v) || FONT_DEFAULT));
    document.documentElement.style.setProperty("--code-size", n + "px");
    els.setFont.value = String(n);
    els.setFontVal.textContent = n + " px";
    return n;
  }

  els.setFont.addEventListener("input", (ev) => {
    const n = applyFont(ev.target.value);
    save(KEY.font, String(n));
  });
  els.setReset.addEventListener("click", () => {
    applyFont(FONT_DEFAULT);
    save(KEY.font, String(FONT_DEFAULT));
    toast("Settings restored to defaults.", "ok");
  });

  /* ------------------------------------------------------------------ theme */

  const ICON_SUN = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/></svg>';
  const ICON_MOON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';

  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    els.theme.innerHTML = t === "light" ? ICON_MOON : ICON_SUN;
    save(KEY.theme, t);
  }
  function toggleTheme() {
    applyTheme(document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light");
  }
  els.theme.addEventListener("click", toggleTheme);

  /* ------------------------------------------------------------- splitter */

  let dragging = false;
  els.splitter.addEventListener("pointerdown", (ev) => {
    dragging = true;
    els.splitter.classList.add("dragging");
    els.splitter.setPointerCapture(ev.pointerId);
  });
  els.splitter.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    const rect = els.workbench.getBoundingClientRect();
    const pct = ((ev.clientX - rect.left - 16) / (rect.width - 32)) * 100;
    els.workbench.style.setProperty("--split", Math.min(75, Math.max(25, pct)).toFixed(1) + "%");
  });
  const endDrag = () => { dragging = false; els.splitter.classList.remove("dragging"); };
  els.splitter.addEventListener("pointerup", endDrag);
  els.splitter.addEventListener("pointercancel", endDrag);
  els.splitter.addEventListener("dblclick", () => els.workbench.style.removeProperty("--split"));

  /* ----------------------------------------------------- buttons and keys */

  els.compile.addEventListener("click", () => { if (!activeRun) compile(); });
  els.run.addEventListener("click", run);
  els.stop.addEventListener("click", stopRun);
  els.btnHelp.addEventListener("click", () => els.help.showModal());
  $$("[data-close]").forEach((b) => b.addEventListener("click", () => els.help.close()));
  $$(".output-pane .tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));

  document.addEventListener("keydown", (ev) => {
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.key === "Enter") {
      ev.preventDefault();
      if (ev.shiftKey) run(); else if (!activeRun) compile();
    } else if (mod && (ev.key === "s" || ev.key === "S")) {
      ev.preventDefault();
      saveProgram();
    } else if (mod && (ev.key === "b" || ev.key === "B")) {
      ev.preventDefault();
      setSide(!sideOpen());
    } else if (mod && ev.shiftKey && (ev.key === "l" || ev.key === "L")) {
      ev.preventDefault();
      toggleTheme();
    } else if (ev.key === "Escape" && sideOpen()) {
      setSide(false);
    }
  });

  /* ---------------------------------------------------------------- startup */

  loadSampleOptions();
  applyTheme(load(KEY.theme, "dark") === "light" ? "light" : "dark");
  applyFont(Number(load(KEY.font, String(FONT_DEFAULT))));
  renderPrograms();

  const draft = load(KEY.draft, "");
  const first = SAMPLES.find((s) => s.name === "hello") || SAMPLES[0];
  setSource(draft.trim() ? draft : (first ? first.source : ""));
  if (first) els.sampleInfo.textContent = first.description;
  compile();
  els.stdin.value = "";

  /* Ambient background: a few drifting particles that link when they pass close together. */
  (() => {
    const canvas = $("bg-canvas");
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext("2d");
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const LINK = 140;
    let w = 0, h = 0, pts = [];

    function palette() {
      return document.documentElement.getAttribute("data-theme") === "light"
        ? ["109,40,217", "162,28,175", "14,116,144"]
        : ["196,181,253", "216,180,254", "103,232,249"];
    }
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(60, Math.max(18, Math.round((w * h) / 22000)));
      pts = Array.from({ length: n }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
        r: 0.9 + Math.random() * 1.3, c: Math.floor(Math.random() * 3),
      }));
    }
    function draw() {
      const cols = palette();
      ctx.clearRect(0, 0, w, h);
      if (!reduce) {
        for (const p of pts) {
          p.x += p.vx; p.y += p.vy;
          if (p.x < -20) p.x = w + 20; else if (p.x > w + 20) p.x = -20;
          if (p.y < -20) p.y = h + 20; else if (p.y > h + 20) p.y = -20;
        }
      }
      ctx.lineWidth = 1;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i], b = pts[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < LINK) {
            ctx.strokeStyle = `rgba(${cols[a.c]}, ${((1 - d / LINK) * 0.22).toFixed(3)})`;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      for (const p of pts) {
        ctx.fillStyle = `rgba(${cols[p.c]}, 0.6)`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      if (!reduce) requestAnimationFrame(draw);
    }
    resize();
    draw();
    window.addEventListener("resize", () => { resize(); if (reduce) draw(); });
    new MutationObserver(() => { if (reduce) draw(); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  })();
})();
