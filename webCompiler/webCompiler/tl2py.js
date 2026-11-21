/* TraceLang -> Python translator.
 *
 * One file, no dependencies. It works in the browser (window.TraceLang) and in Node
 * (require("./tl2py.js")). It does what the compiler's front end does:
 *   1. lexer      : indentation (INDENT/DEDENT), tokens, string escapes
 *   2. parser     : recursive descent with the same precedence as parser/parser.y
 *   3. checker    : names, scopes, types, definite assignment, function rules
 *   4. generator  : readable Python 3 code that behaves like the native program
 *
 * translate(source) returns { ok: true, python } or
 *   { ok: false, error: { category, line, col, message, fix } }.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TraceLang = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  class CompileError extends Error {
    constructor(category, line, col, message, fix) {
      super(message);
      this.category = category;
      this.line = line;
      this.col = col;
      this.fix = fix || "";
    }
  }

  const KEYWORDS = new Map([
    ["start", "START"], ["end", "END"], ["show", "SHOW"], ["write", "WRITE"],
    ["if", "IF"], ["elif", "ELIF"], ["else", "ELSE"], ["while", "WHILE"],
    ["for", "FOR"], ["in", "IN"], ["to", "TO"], ["function", "FUNCTION"],
    ["return", "RETURN"], ["and", "AND"], ["or", "OR"], ["not", "NOT"],
    ["true", "TRUE"], ["false", "FALSE"],
    ["int", "TYPE"], ["float", "TYPE"], ["string", "TYPE"], ["bool", "TYPE"],
  ]);
  const MULTI = new Map([["==", "EQ"], ["!=", "NE"], ["<=", "LE"], [">=", "GE"], ["->", "ARROW"]]);
  const SINGLE = new Set(["(", ")", ":", ",", "<", ">", "=", "+", "-", "*", "/", "%"]);
  const INT_MAX = 9223372036854775807n;
  const PY_RESERVED = new Set([
    "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue",
    "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in",
    "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
    "print", "range", "str", "int", "float", "bool", "abs", "round", "len", "input", "sys", "math", "re",
  ]);

  /* ------------------------------------------------------------------ lexer */

  function lex(src) {
    const toks = [];
    const stack = [0];
    const push = (type, value, line, col) => toks.push({ type, value, line, col });
    let i = 0, line = 1, col = 1, fresh = true, pending = 0;

    while (i < src.length) {
      const ch = src[i];

      if (col === 1 && ch === " ") {              /* leading spaces set the indent of the line */
        let n = 0;
        while (src[i] === " ") { i++; n++; }
        col += n;
        pending = n;
        continue;
      }
      if (ch === " " || ch === "\r") { i++; col++; continue; }
      if (ch === "#") {                           /* comment runs to the end of the line */
        while (i < src.length && src[i] !== "\n") i++;
        continue;
      }
      if (ch === "\t") {
        throw new CompileError("Lexical", line, col, "tab characters are not allowed; indent with spaces",
          "replace the tab with spaces");
      }
      if (ch === "\n") {
        if (!fresh) { push("NEWLINE", "<newline>", line, col); fresh = true; }
        i++; line++; col = 1; pending = 0;
        continue;
      }

      const tl = line, tc = col;
      if (fresh) {                                /* first real token of a line: INDENT or DEDENTs */
        fresh = false;
        if (pending > stack[stack.length - 1]) {
          stack.push(pending);
          push("INDENT", "<indent>", tl, 1);
        } else {
          while (pending < stack[stack.length - 1]) {
            stack.pop();
            push("DEDENT", "<dedent>", tl, 1);
          }
          if (pending !== stack[stack.length - 1]) {
            throw new CompileError("Lexical", tl, 1,
              `inconsistent indentation (${pending} spaces) does not match any outer block`,
              "line up this line with the indentation of an earlier line");
          }
        }
      }

      if (/[A-Za-z_]/.test(ch)) {
        let j = i;
        while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
        const word = src.slice(i, j);
        push(KEYWORDS.get(word) || "IDENT", word, tl, tc);
        col += j - i; i = j;
        continue;
      }

      if (/[0-9]/.test(ch)) {
        let j = i;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
        if (src[j] === "." && /[0-9]/.test(src[j + 1] || "")) {
          j++;
          while (j < src.length && /[0-9]/.test(src[j])) j++;
          push("FLOAT", Number(src.slice(i, j)), tl, tc);
        } else {
          let v = BigInt(src.slice(i, j));
          if (v > INT_MAX) v = INT_MAX;           /* the native lexer saturates too */
          push("INT", v, tl, tc);
        }
        col += j - i; i = j;
        continue;
      }

      if (ch === '"') {
        let j = i + 1, out = "";
        const ESC = { n: "\n", t: "\t", '"': '"', "\\": "\\" };
        for (;;) {
          if (j >= src.length || src[j] === "\n") {
            throw new CompileError("Lexical", tl, tc, "unterminated string literal",
              'close the text with " on the same line');
          }
          if (src[j] === '"') { j++; break; }
          if (src[j] === "\\") {
            const e = src[j + 1];
            if (!Object.prototype.hasOwnProperty.call(ESC, e)) {
              throw new CompileError("Lexical", tl, tc, `unknown escape sequence '\\${e || ""}'`,
                "use \\n, \\t, \\\" or \\\\");
            }
            out += ESC[e];
            j += 2;
            continue;
          }
          out += src[j];
          j++;
        }
        push("STRING", out, tl, tc);
        col += j - i; i = j;
        continue;
      }

      const two = src.substr(i, 2);
      if (MULTI.has(two)) {
        push(MULTI.get(two), two, tl, tc);
        col += 2; i += 2;
        continue;
      }
      if (SINGLE.has(ch)) {
        push(ch, ch, tl, tc);
        col += 1; i += 1;
        continue;
      }
      throw new CompileError("Lexical", tl, tc, `invalid character '${ch}'`,
        "remove the character, or check the language reference for the valid symbols");
    }

    if (!fresh) push("NEWLINE", "<newline>", line, col);
    while (stack.length > 1) { stack.pop(); push("DEDENT", "<dedent>", line, 1); }
    push("EOF", "<end of file>", line, col);
    return toks;
  }

  /* ----------------------------------------------------------------- parser */

  const CMP_OPS = { EQ: "==", NE: "!=", "<": "<", ">": ">", LE: "<=", GE: ">=" };

  function describe(t) {
    switch (t.type) {
      case "NEWLINE": return "end of line";
      case "INDENT": return "indentation";
      case "DEDENT": return "dedent";
      case "EOF": return "end of file";
      case "IDENT": return `name '${t.value}'`;
      case "INT": case "FLOAT": return `number ${t.value}`;
      case "STRING": return "text";
      case "TYPE": return `type '${t.value}'`;
      default: return `'${t.value}'`;
    }
  }

  function syntaxFix(t) {
    switch (t.type) {
      case "NEWLINE": return "the line is incomplete: finish the expression, or add the missing value after '=' or ':'";
      case "INDENT": return "indent only after a line that ends with ':' (if, while, for, function, else, elif)";
      case "DEDENT": return "check the indentation: each block must be indented the same amount, and 'end' must be at column 1";
      case "EOF": return "add 'end' on its own line at the bottom of the program";
      case ":": return "':' only belongs after if, elif, else, while, for or a function header";
      default: return "check the spelling, the brackets and the colons on this line";
    }
  }

  function parse(tokens) {
    let p = 0;
    const peek = (k = 0) => tokens[Math.min(p + k, tokens.length - 1)];
    const at = (type) => peek().type === type;
    const next = () => tokens[Math.min(p++, tokens.length - 1)];
    const fail = (t, fix) => {
      throw new CompileError("Syntax", t.line, t.col, `syntax error, unexpected ${describe(t)}`, fix || syntaxFix(t));
    };
    const expect = (type, fix) => {
      if (!at(type)) fail(peek(), fix);
      return next();
    };
    const typeTok = () => {
      if (!at("TYPE")) fail(peek(), "use one of the types: int, float, string or bool");
      return next().value;
    };

    function program() {
      const start = expect("START");
      expect("NEWLINE");
      const body = stmtsUntil(["END"]);
      expect("END");
      if (at("NEWLINE")) next();
      if (!at("EOF")) fail(peek());
      return { k: "Program", body, line: start.line, col: start.col };
    }

    function stmtsUntil(stops) {
      const list = [];
      while (!stops.includes(peek().type)) {
        if (at("EOF")) fail(peek());
        list.push(statement());
      }
      return list;
    }

    function suite() {
      expect("NEWLINE", "end the 'if', 'while', 'for' or 'function' line with ':' and put the block below it");
      expect("INDENT", "indent the lines of this block");
      const body = stmtsUntil(["DEDENT"]);
      expect("DEDENT");
      return body;
    }

    function elsePart() {
      if (at("ELIF")) {
        const t = next();
        const cond = expr();
        expect(":");
        const body = suite();
        const orelse = elsePart();
        return [{ k: "If", cond, body, orelse, isElif: true, line: t.line, col: t.col }];
      }
      if (at("ELSE")) {
        next();
        expect(":");
        return suite();
      }
      return null;
    }

    function paramList() {
      const params = [];
      if (at(")")) return params;
      for (;;) {
        const name = expect("IDENT");
        expect(":");
        const type = typeTok();
        params.push({ name: name.value, type, line: name.line, col: name.col });
        if (!at(",")) break;
        next();
      }
      return params;
    }

    function callExpr() {
      const name = expect("IDENT");
      expect("(");
      const args = [];
      if (!at(")")) {
        args.push(expr());
        while (at(",")) { next(); args.push(expr()); }
      }
      expect(")");
      return { k: "Call", name: name.value, args, line: name.line, col: name.col };
    }

    function statement() {
      const t = peek();
      switch (t.type) {
        case "IDENT": {
          const n = peek(1);
          if (n.type === ":") {
            next(); next();
            const type = typeTok();
            let init = null;
            if (at("=")) { next(); init = expr(); }
            expect("NEWLINE");
            return { k: "Decl", name: t.value, type, init, line: t.line, col: t.col };
          }
          if (n.type === "=") {
            next(); next();
            const value = expr();
            expect("NEWLINE");
            return { k: "Assign", name: t.value, value, line: t.line, col: t.col };
          }
          if (n.type === "(") {
            const call = callExpr();
            expect("NEWLINE");
            return { k: "CallStmt", call, line: t.line, col: t.col };
          }
          fail(n);
          break;
        }
        case "WRITE": {
          next();
          const name = expect("IDENT");
          let type = null;
          if (at(":")) { next(); type = typeTok(); }
          expect("NEWLINE");
          return { k: "Write", name: name.value, type, line: t.line, col: t.col };
        }
        case "SHOW": {
          next();
          const value = expr();
          expect("NEWLINE");
          return { k: "Show", value, line: t.line, col: t.col };
        }
        case "IF": {
          next();
          const cond = expr();
          expect(":");
          const body = suite();
          const orelse = elsePart();
          return { k: "If", cond, body, orelse, isElif: false, line: t.line, col: t.col };
        }
        case "WHILE": {
          next();
          const cond = expr();
          expect(":");
          const body = suite();
          return { k: "While", cond, body, line: t.line, col: t.col };
        }
        case "FOR": {
          next();
          const v = expect("IDENT");
          expect("IN");
          const from = expr();
          expect("TO");
          const to = expr();
          expect(":");
          const body = suite();
          return { k: "For", name: v.value, from, to, body, line: t.line, col: t.col };
        }
        case "FUNCTION": {
          next();
          const name = expect("IDENT");
          expect("(");
          const params = paramList();
          expect(")");
          let ret = null;
          if (at("ARROW")) { next(); ret = typeTok(); }
          expect(":");
          const body = suite();
          return { k: "Func", name: name.value, params, ret, body, line: t.line, col: t.col };
        }
        case "RETURN": {
          next();
          let value = null;
          if (!at("NEWLINE")) value = expr();
          expect("NEWLINE");
          return { k: "Return", value, line: t.line, col: t.col };
        }
        default:
          fail(t);
      }
      return null;
    }

    /* Precedence, lowest first: or, and, not, comparisons (non-associative), + -, * / %, unary - */
    function bin(op, l, r) {
      return { k: "Bin", op, l, r, line: l.line, col: l.col };
    }
    function expr() { return orExpr(); }
    function orExpr() {
      let l = andExpr();
      while (at("OR")) { next(); l = bin("or", l, andExpr()); }
      return l;
    }
    function andExpr() {
      let l = notExpr();
      while (at("AND")) { next(); l = bin("and", l, notExpr()); }
      return l;
    }
    function notExpr() {
      if (at("NOT")) {
        const t = next();
        return { k: "Un", op: "not", e: notExpr(), line: t.line, col: t.col };
      }
      return cmpExpr();
    }
    function cmpExpr() {
      let l = addExpr();
      if (CMP_OPS[peek().type]) {
        const op = CMP_OPS[next().type];
        l = bin(op, l, addExpr());
        if (CMP_OPS[peek().type]) fail(peek());        /* a < b < c is an error */
      }
      return l;
    }
    function addExpr() {
      let l = mulExpr();
      while (at("+") || at("-")) { const op = next().type; l = bin(op, l, mulExpr()); }
      return l;
    }
    function mulExpr() {
      let l = unaryExpr();
      while (at("*") || at("/") || at("%")) { const op = next().type; l = bin(op, l, unaryExpr()); }
      return l;
    }
    function unaryExpr() {
      if (at("-")) {
        const t = next();
        return { k: "Un", op: "-", e: unaryExpr(), line: t.line, col: t.col };
      }
      return primary();
    }
    function primary() {
      const t = peek();
      switch (t.type) {
        case "INT": next(); return { k: "Int", v: t.value, line: t.line, col: t.col };
        case "FLOAT": next(); return { k: "Float", v: t.value, line: t.line, col: t.col };
        case "STRING": next(); return { k: "Str", v: t.value, line: t.line, col: t.col };
        case "TRUE": next(); return { k: "Bool", v: true, line: t.line, col: t.col };
        case "FALSE": next(); return { k: "Bool", v: false, line: t.line, col: t.col };
        case "IDENT":
          if (peek(1).type === "(") return callExpr();
          next();
          return { k: "Id", name: t.value, line: t.line, col: t.col };
        case "(": {
          next();
          const e = expr();
          expect(")");
          return e;
        }
        case "NOT": return notExpr();              /* allowed as an operand, like the grammar */
        default:
          fail(t);
      }
      return null;
    }

    return program();
  }

  /* ---------------------------------------------------- checker + generator */

  const TYPE_NAMES = { int: "int", float: "float", string: "string", bool: "bool" };

  function floatLit(v) {
    let s = String(v);
    if (!/[.e]/.test(s)) s += ".0";
    return s;
  }

  function alwaysReturns(list) {
    return list.some((n) => n.k === "Return" ||
      (n.k === "If" && n.orelse && alwaysReturns(n.body) && alwaysReturns(n.orelse)));
  }

  function intersect(a, b) {
    const out = new Set();
    for (const x of a) if (b.has(x)) out.add(x);
    return out;
  }

  function generate(ast) {
    const usedPy = new Set();
    let scopes = [new Map()];           /* scopes[0] is the program's top level (the globals) */
    let assigned = new Set();           /* symbols that definitely have a value here */
    let curFunc = null;                 /* the function being generated, or null */

    const fail = (node, category, message, fix) => {
      throw new CompileError(category, node.line, node.col, message, fix);
    };

    function pyName(name) {
      let base = name[0] === "_" ? "v" + name : name;
      if (PY_RESERVED.has(base)) base += "_";
      let cand = base, k = 2;
      while (usedPy.has(cand)) cand = `${base}_${k++}`;
      usedPy.add(cand);
      return cand;
    }

    function lookup(name) {
      for (let i = scopes.length - 1; i >= 0; i--) {
        if (scopes[i].has(name)) return scopes[i].get(name);
      }
      return null;
    }

    function declare(node, name, kind, type, extra) {
      const here = scopes[scopes.length - 1];
      if (here.has(name)) {
        const prev = here.get(name);
        fail(node, "Semantic", `duplicate declaration of '${name}' (first declared on line ${prev.line})`,
          `choose another name, for example '${name}2'`);
      }
      const sym = Object.assign({ kind, name, type, pyName: pyName(name), isGlobal: scopes.length === 1,
        readonly: false, line: node.line, col: node.col }, extra || {});
      here.set(name, sym);
      return sym;
    }

    function checkWritable(sym, node) {
      if (sym.kind === "func") {
        fail(node, "Semantic", `'${sym.name}' is a function and cannot be assigned`,
          "use a different name for the variable");
      }
      if (sym.readonly) {
        fail(node, "Semantic", `loop variable '${sym.name}' cannot be changed inside its loop`,
          "use a separate variable, for example 'total = total + i'");
      }
      if (sym.isGlobal && curFunc) {
        fail(node, "Semantic", `a function cannot change the global variable '${sym.name}' (TraceLang v1 rule)`,
          "pass the value in as a parameter and return the new value instead");
      }
    }

    function expectType(node, got, want, what) {
      if (got !== want) {
        fail(node, "Type", `${what} has type ${got}, but ${want} is required`, `use a value of type ${want} here`);
      }
    }

    /* Returns the value converted to the wanted type, or fails if it is not assignable */
    function coerce(node, v, want, what) {
      if (v.ty === want) return v;
      if (v.ty === "int" && want === "float") return toFloat(node, v);
      fail(node, "Type", `${what} has type ${v.ty}, but ${want} is required`, `use a value of type ${want} here`);
      return v;
    }

    function genCall(c) {
      const sym = lookup(c.name);
      if (!sym) {
        fail(c, "Semantic", `undeclared function '${c.name}'`,
          "declare the function before calling it, with 'function name(...)'");
      }
      if (sym.kind !== "func") {
        fail(c, "Semantic", `'${c.name}' is not a function`, "call a function here, or rename the variable");
      }
      if (c.args.length !== sym.params.length) {
        fail(c, "Semantic", `function '${c.name}' expects ${sym.params.length} argument(s), got ${c.args.length}`,
          "pass the arguments in the same order as the function header");
      }
      const args = c.args.map((a, i) => {
        return coerce(a, genValue(a), sym.params[i], `argument ${i + 1} of '${c.name}'`).py;
      });
      return { py: `${sym.pyName}(${args.join(", ")})`, ty: sym.ret || "void" };
    }

    function genExpr(e) {
      switch (e.k) {
        case "Int": return { py: e.v.toString(), ty: "int" };
        case "Float": return { py: floatLit(e.v), ty: "float" };
        case "Str": return { py: JSON.stringify(e.v), ty: "string" };
        case "Bool": return { py: e.v ? "True" : "False", ty: "bool" };
        case "Id": {
          const sym = lookup(e.name);
          if (!sym) {
            fail(e, "Semantic", `undeclared variable '${e.name}'`,
              `declare it first, for example '${e.name}: int = 0'`);
          }
          if (sym.kind === "func") {
            fail(e, "Semantic", `'${e.name}' is a function and cannot be used as a value`,
              `call it with parentheses, for example '${e.name}()'`);
          }
          if (!assigned.has(sym)) {
            fail(e, "Semantic", `variable '${e.name}' is used before it gets a value`,
              `give it a value first, for example '${e.name} = 0'`);
          }
          return { py: sym.pyName, ty: sym.type };
        }
        case "Call": return genCall(e);
        case "Un": {
          const v = genValue(e.e);
          if (e.op === "not") {
            expectType(e.e, v.ty, "bool", "the operand of 'not'");
            return { py: `(not ${v.py})`, ty: "bool" };
          }
          if (v.ty === "int") return { py: `(-${v.py})`, ty: "int" };
          if (v.ty === "float") return { py: `(-${v.py})`, ty: "float" };
          fail(e, "Type", `'-' needs an int or float value, not ${v.ty}`, "use an int or float operand with '-'");
          break;
        }
        case "Bin": return genBin(e);
        default:
          fail(e, "Internal", `unknown expression ${e.k}`, "");
      }
      return null;
    }

    const isNum = (t) => t === "int" || t === "float";

    /* int widens to float implicitly; literal ints become float literals */
    function toFloat(node, v) {
      if (v.ty === "float") return v;
      return { py: node.k === "Int" ? floatLit(Number(node.v)) : `float(${v.py})`, ty: "float" };
    }

    function genBin(e) {
      const l = genValue(e.l);
      const r = genValue(e.r);
      const op = e.op;
      if (op === "and" || op === "or") {
        if (l.ty !== "bool" || r.ty !== "bool") {
          fail(e, "Type", `'${op}' needs bool values`, "compare the values, for example 'x > 0'");
        }
        return { py: `(${l.py} ${op} ${r.py})`, ty: "bool" };
      }
      if (op === "==" || op === "!=" || op === "<" || op === ">" || op === "<=" || op === ">=") {
        const numeric = isNum(l.ty) && isNum(r.ty);
        if (op === "==" || op === "!=") {
          if (!(numeric || l.ty === r.ty)) fail(e, "Type", `cannot compare ${l.ty} with ${r.ty}`, "compare values of the same type");
        } else if (!numeric) {
          fail(e, "Type", "order comparisons work on int and float values",
            "compare two numbers, for example 'x < 10'");
        }
        let a = l, b = r;
        if (numeric && l.ty !== r.ty) { a = toFloat(e.l, l); b = toFloat(e.r, r); }
        return { py: `(${a.py} ${op} ${b.py})`, ty: "bool" };
      }
      if (!isNum(l.ty) || !isNum(r.ty)) {
        if (l.ty === "string" || r.ty === "string") {
          fail(e, "Type", "text cannot be joined with '" + op + "': TraceLang v1 has no string concatenation",
            "show the parts on separate lines instead");
        }
        fail(e, "Type", `operator '${op}' needs numeric operands, not ${l.ty} and ${r.ty}`,
          "use int or float operands");
      }
      if (op === "%") {
        if (l.ty !== "int" || r.ty !== "int") fail(e, "Type", "'%' works on int values only", "use int values with '%'");
        return { py: `_tl_mod(${l.py}, ${r.py})`, ty: "int" };
      }
      if (op === "/" && e.r.k === "Int" && e.r.v === 0n) {
        fail(e.r, "Semantic", "division by zero", "use a non-zero divisor");
      }
      if (l.ty === "int" && r.ty === "int") {
        if (op === "/") return { py: `_tl_div(${l.py}, ${r.py})`, ty: "int" };
        if (op === "*") return { py: `_tl_wrap(${l.py} * ${r.py})`, ty: "int" };   /* only * can overflow in practice */
        return { py: `(${l.py} ${op} ${r.py})`, ty: "int" };
      }
      const a = toFloat(e.l, l), b = toFloat(e.r, r);
      if (op === "/") return { py: `_tl_fdiv(${a.py}, ${b.py})`, ty: "float" };
      return { py: `(${a.py} ${op} ${b.py})`, ty: "float" };
    }

    /* A value that must not be void (a function without a return type) */
    function genValue(e) {
      const v = genExpr(e);
      if (v.ty === "void") {
        fail(e, "Type", "this function does not return a value",
          "return a value from the function, or call it as a statement");
      }
      return v;
    }

    function genCond(e, what) {
      const v = genValue(e);
      if (v.ty !== "bool") {
        fail(e, "Type", `the condition of '${what}' must be bool, not ${v.ty}`,
          "compare the value, for example 'x > 0', or use true or false");
      }
      return v.py;
    }

    function emitBody(list, ind, out) {
      const before = out.length;
      for (const s of list) genStmt(s, ind, out);
      if (out.length === before) out.push(ind + "pass");
    }

    /* Runs a block in its own scope. Returns nothing; the caller manages `assigned`. */
    function suiteBlock(list, ind, out) {
      scopes.push(new Map());
      try { emitBody(list, ind, out); } finally { scopes.pop(); }
    }

    function genIf(node, ind, out, kw) {
      const cond = genCond(node.cond, kw);
      out.push(`${ind}${kw} ${cond}:`);
      const before = new Set(assigned);
      assigned = new Set(before);
      suiteBlock(node.body, ind + "    ", out);
      const afterBody = assigned;
      if (!node.orelse) {
        assigned = before;
        return before;
      }
      assigned = new Set(before);
      let afterElse;
      if (node.orelse.length === 1 && node.orelse[0].k === "If" && node.orelse[0].isElif) {
        afterElse = genIf(node.orelse[0], ind, out, "elif");
      } else {
        out.push(`${ind}else:`);
        suiteBlock(node.orelse, ind + "    ", out);
        afterElse = assigned;
      }
      return intersect(afterBody, afterElse);
    }

    function genStmt(s, ind, out) {
      switch (s.k) {
        case "Decl": {
          const sym = declare(s, s.name, "var", s.type);
          if (s.init) {
            const v = coerce(s.init, genValue(s.init), s.type, `the value of '${s.name}'`);
            assigned.add(sym);
            out.push(`${ind}${sym.pyName} = ${v.py}`);
          }
          return;
        }
        case "Assign": {
          const sym = lookup(s.name);
          if (!sym) {
            fail(s, "Semantic", `undeclared variable '${s.name}'`,
              `declare it first, for example '${s.name}: int = 0'`);
          }
          checkWritable(sym, s);
          const v = coerce(s.value, genValue(s.value), sym.type, `'${s.name}'`);
          assigned.add(sym);
          out.push(`${ind}${sym.pyName} = ${v.py}`);
          return;
        }
        case "Write": {
          let sym;
          if (s.type) {
            sym = declare(s, s.name, "var", s.type);
          } else {
            sym = lookup(s.name);
            if (!sym) {
              fail(s, "Semantic", `undeclared variable '${s.name}'`,
                `declare the variable first, or write 'write ${s.name}: int'`);
            }
            checkWritable(sym, s);
          }
          assigned.add(sym);
          out.push(`${ind}${sym.pyName} = _tl_read_${sym.type}()`);
          return;
        }
        case "Show": {
          const v = genValue(s.value);
          if (v.ty === "float") out.push(`${ind}print(_tl_fmt(${v.py}))`);
          else if (v.ty === "bool") out.push(`${ind}print("true" if ${v.py} else "false")`);
          else out.push(`${ind}print(${v.py})`);
          return;
        }
        case "If": {
          const after = genIf(s, ind, out, "if");
          assigned = after;
          return;
        }
        case "While": {
          const cond = genCond(s.cond, "while");
          out.push(`${ind}while ${cond}:`);
          const before = new Set(assigned);
          suiteBlock(s.body, ind + "    ", out);
          assigned = before;            /* the body may run zero times */
          return;
        }
        case "For": {
          const from = genValue(s.from);
          const to = genValue(s.to);
          expectType(s.from, from.ty, "int", "the start of the loop");
          expectType(s.to, to.ty, "int", "the end of the loop");
          const before = new Set(assigned);
          scopes.push(new Map());
          try {
            const sym = declare(s, s.name, "var", "int");
            sym.readonly = true;
            assigned.add(sym);
            out.push(`${ind}for ${sym.pyName} in range(${from.py}, (${to.py}) + 1):`);
            suiteBlock(s.body, ind + "    ", out);
          } finally {
            scopes.pop();
          }
          assigned = before;
          return;
        }
        case "Func": {
          if (scopes.length !== 1 || curFunc) {
            fail(s, "Semantic", "a function can only be defined at the top level of the program",
              "move the function to the top of the program, outside other blocks");
          }
          const params = s.params.map((p) => ({ type: p.type }));
          const sym = declare(s, s.name, "func", "func", {
            params: params.map((p) => p.type), ret: s.ret,
          });
          const outerAssigned = assigned;
          scopes.push(new Map());
          const pyParams = [];
          assigned = new Set(outerAssigned);
          const savedFunc = curFunc;
          curFunc = { ret: s.ret };
          try {
            for (const p of s.params) {
              const psym = declare(p, p.name, "var", p.type);
              assigned.add(psym);
              pyParams.push(psym.pyName);
            }
            if (s.ret && !alwaysReturns(s.body)) {
              fail(s, "Semantic", `function '${s.name}' must end with 'return <value>'`,
                "add 'return <value>' as the last line of the function");
            }
            const body = [];
            emitBody(s.body, ind + "    ", body);
            out.push(`${ind}def ${sym.pyName}(${pyParams.join(", ")}):`);
            out.push(...body);
          } finally {
            scopes.pop();
            curFunc = savedFunc;
            assigned = outerAssigned;
          }
          return;
        }
        case "Return": {
          if (!curFunc) {
            fail(s, "Semantic", "'return' is only allowed inside a function",
              "remove it, or move it inside a function");
          }
          if (!s.value) {
            if (curFunc.ret) {
              fail(s, "Type", `this function returns ${curFunc.ret}, so 'return' needs a value`,
                `write 'return <${curFunc.ret} value>'`);
            }
            out.push(`${ind}return`);
            return;
          }
          if (!curFunc.ret) {
            fail(s.value, "Type", "this function has no return type, so 'return' takes no value",
              "remove the value, or add '-> type' to the function header");
          }
          const v = coerce(s.value, genValue(s.value), curFunc.ret, "the returned value");
          out.push(`${ind}return ${v.py}`);
          return;
        }
        case "CallStmt": {
          out.push(`${ind}${genCall(s.call).py}`);
          return;
        }
        default:
          fail(s, "Internal", `unknown statement ${s.k}`, "");
      }
    }

    const body = [];
    for (const s of ast.body) genStmt(s, "    ", body);
    if (body.length === 0) body.push("    pass");
    return body;
  }

  const HELPERS = `import math
import re
import sys

sys.setrecursionlimit(5000)


class _TLError(Exception):
    pass


def _tl_wrap(v):
    # 64-bit two's complement, like the native int type
    v &= 0xFFFFFFFFFFFFFFFF
    return v - 0x10000000000000000 if v >= 0x8000000000000000 else v


def _tl_div(a, b):
    if b == 0:
        raise _TLError("runtime error: division by zero")
    q = abs(a) // abs(b)          # division truncates toward zero
    return _tl_wrap(q if (a < 0) == (b < 0) else -q)


def _tl_mod(a, b):
    if b == 0:
        raise _TLError("runtime error: division by zero")
    r = abs(a) % abs(b)           # the remainder takes the sign of the dividend
    return _tl_wrap(-r if a < 0 else r)


def _tl_fdiv(a, b):
    if b == 0.0:
        if a == 0.0 or math.isnan(a):
            return math.nan
        return math.copysign(math.inf, a) * math.copysign(1.0, b)
    return a / b


def _tl_fmt(v):
    # six decimal places, rounded to nearest (half to even), like the native float output
    n = round(v * 1000000.0)
    sign = "-" if n < 0 else ""
    n = abs(n)
    return "%s%d.%06d" % (sign, n // 1000000, n % 1000000)


def _tl_line():
    if not _tl_inputs:
        raise _TLError("runtime error: no more input")
    return _tl_inputs.pop(0)


def _tl_read_int():
    s = _tl_line()
    i = 0
    while i < len(s) and s[i] == " ":
        i += 1
    neg = i < len(s) and s[i] == "-"
    if neg:
        i += 1
    j = i
    while j < len(s) and "0" <= s[j] <= "9":
        j += 1
    if j == i:
        raise _TLError("runtime error: expected an integer input")
    v = int(s[i:j])
    return _tl_wrap(-v if neg else v)


def _tl_read_float():
    s = _tl_line().strip(" ")
    if not re.fullmatch(r"-?[0-9]+(\\.[0-9]+)?", s):
        raise _TLError("runtime error: expected a number input")
    return float(s)


def _tl_read_bool():
    s = _tl_line()
    if s == "true":
        return True
    if s == "false":
        return False
    raise _TLError("runtime error: expected true or false")


def _tl_read_string():
    return _tl_line()



try:
    _tl_inputs
except NameError:
    _tl_inputs = []


__all__ = ["_TLError", "_tl_wrap", "_tl_div", "_tl_mod", "_tl_fdiv", "_tl_fmt",
           "_tl_line", "_tl_read_int", "_tl_read_float", "_tl_read_bool", "_tl_read_string"]
`;

  /* Removes one level of indentation: the program is shown at the top level of the file. */
  function dedent(lines) {
    return lines.map((l) => (l.startsWith("    ") ? l.slice(4) : l));
  }

  function translate(source) {
    try {
      const tokens = lex(source);
      const ast = parse(tokens);
      const program = dedent(generate(ast)).join("\n");
      const runtime = HELPERS.trimEnd() + "\n";
      const python = [
        "# Generated by webCompiler from your TraceLang program.",
        "# The helper functions (division, output format, input) are in tl_runtime.",
        "from tl_runtime import *",
        "",
        "",
        program,
        "",
      ].join("\n");
      return {
        ok: true,
        python,                       /* what the Python tab shows */
        runtime,                      /* the helper functions */
        full: runtime + "\n\n" + program + "\n",   /* one file that runs on its own */
      };
    } catch (err) {
      if (err instanceof CompileError) {
        return {
          ok: false,
          error: { category: err.category, line: err.line, col: err.col, message: err.message, fix: err.fix },
        };
      }
      throw err;
    }
  }

  return { translate, lex, parse, CompileError };
});
