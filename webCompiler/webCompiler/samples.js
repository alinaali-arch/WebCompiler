/* Sample programs (generated from examples/*.tl) */
window.WC_SAMPLES = [
 {
  "name": "control",
  "description": "if, elif, else and while",
  "source": "start\n\nmarks: int = 62\ni: int = 1\n\nif marks >= 50:\n    show \"Pass\"\n    if marks >= 80:\n        show \"Distinction\"\nelse:\n    show \"Fail\"\n\nwhile i <= 3:\n    show i\n    i = i + 1\n\nfor j in 1 to 3:\n    show j\n\nend\n"
 },
 {
  "name": "fibonacci",
  "description": "Recursion and a for loop",
  "source": "start\n\nfunction fib(n: int) -> int:\n    if n < 2:\n        return n\n    return fib(n - 1) + fib(n - 2)\n\ni: int = 0\nwhile i <= 10:\n    show fib(i)\n    i = i + 1\n\nend\n"
 },
 {
  "name": "float_math",
  "description": "Float arithmetic and the six decimal output",
  "source": "start\n\nradius: float = 2.5\npi: float = 3.14159\narea: float = pi * radius * radius\nshow area\nhalf: float = area / 2.0\nshow half\nbig: bool = area > 10.0\nshow big\nshow -radius\n\nend\n"
 },
 {
  "name": "functions",
  "description": "Functions with parameters and return values",
  "source": "start\n\nfunction add(a: int, b: int) -> int:\n    result: int = a + b\n    return result\n\ntotal: int = add(10, 20)\nshow total\n\nend\n"
 },
 {
  "name": "hello",
  "description": "Variables of each type and show",
  "source": "start\n\nage: int = 20\nname: string = \"Alina\"\nmarks: float = 85.5\npassed: bool = true\n\nshow name\nshow age\nshow age + 10\n\nend\n"
 },
 {
  "name": "primes",
  "description": "Nested loops and a test for prime numbers",
  "source": "start\n\nlimit: int = 30\nn: int = 2\nwhile n <= limit:\n    is_prime: bool = true\n    d: int = 2\n    while d * d <= n:\n        if n % d == 0:\n            is_prime = false\n        d = d + 1\n    if is_prime:\n        show n\n    n = n + 1\n\nend\n"
 }
];
