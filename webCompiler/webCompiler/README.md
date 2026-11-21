# webCompiler

An online compiler for **TraceLang**. You write a TraceLang program in the browser, webCompiler
translates it to **Python**, shows the Python code, and runs it in the browser.

It is a static website: there is no server, no login and no database. Everything runs in the
visitor's browser, so it can be hosted for free on Netlify, GitHub Pages or any static host.

## What you can do

- **Compile** (Ctrl+Enter): translates the program. Errors appear in the Console tab and the
  line is highlighted in the editor. A successful compile shows the Python code in the Python tab.
- **Run** (Ctrl+Shift+Enter): translates the program and runs the Python code with Pyodide
  (Python compiled to WebAssembly) in a Web Worker. Type the input values in the Terminal tab,
  one per line. A program that runs longer than 5 seconds is stopped.
- **Saved programs** (Ctrl+B): save programs in the browser, open, export as `.tl`, import, delete.
- **Settings**: font size. The setting is remembered in the browser.
- **Samples**: six example programs (hello, control, functions, fibonacci, primes, float_math).
- Dark and light theme (Ctrl+Shift+L).

## Files

```
index.html       page layout
style.css        theme, glass surfaces and animations
webcompiler.css  extra styles for the output panels
app.js           editor, Compile, Run, saved programs, settings
tl2py.js         TraceLang -> Python translator (lexer, parser, checker, generator)
worker.js        runs the Python code with Pyodide in a Web Worker
samples.js       sample programs (generated from examples/)
examples/        the sample programs as .tl files
tests/           translator tests (run with Node and Python 3)
```

## How the translator works

1. **Lexer:** indentation blocks (INDENT and DEDENT), keywords, numbers, strings with escapes, comments.
2. **Parser:** recursive descent with the same precedence as the TraceLang grammar.
3. **Checker:** names and scopes, types (int, float, string, bool), definite assignment,
   function rules (top-level only, return types, globals cannot be changed inside functions),
   loop variables cannot be changed, and int-to-float widening.
4. **Generator:** readable Python 3. The Python tab shows only your program; the helper functions
   (division, output format, input) are in `tl_runtime`, which Run and Download include. Integer
   division and remainder follow the C rules (truncation toward zero), and float output has six decimals.

The same rules are used by the native TraceLang compiler, so programs behave the same way.

## Test

```
node tests/run_tests.js
```

It translates every program in `tests/native` and `tests/valid`, runs the Python code with
Python 3, and compares the output with the expected `.out` files. Programs in `tests/invalid`
must be rejected with an error.

## Run it on your computer

Browsers do not run Workers from `file://` pages, so start a small local server:

```
cd webCompiler
python3 -m http.server 8000
```

Then open `http://127.0.0.1:8000`. The first Run downloads Pyodide (about 10 MB) from a CDN,
so it needs internet access. Later runs use the browser cache.

## Deploy on Netlify (free)

1. Go to the Netlify dashboard and drag the `webCompiler` folder onto the drop area
   (or connect a GitHub repository with the publish directory set to the folder root).
2. Netlify gives you a `https://....netlify.app` link. Share it.

No server or database is needed, so the site keeps working when your computer is off.

## Limits

- A program runs in Python, not as native machine code, so it is slower than the native compiler.
  Very heavy loops can hit the 5 second limit.
- The first Run needs internet access to load Pyodide.
- Integer multiplication wraps like a 64-bit integer. Addition and subtraction do not wrap, so the
  result is only different from native code after the value passes 2^63, which is rare in practice.
- Strings are Unicode text.
- Definite assignment is checked conservatively: a variable assigned only inside a loop or
  only in one branch of an `if` is reported as not yet assigned.
- Input is read line by line from the Terminal tab. Input is sent all at once when the program starts.
