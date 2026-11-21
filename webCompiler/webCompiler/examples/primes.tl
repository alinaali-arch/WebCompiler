start

limit: int = 30
n: int = 2
while n <= limit:
    is_prime: bool = true
    d: int = 2
    while d * d <= n:
        if n % d == 0:
            is_prime = false
        d = d + 1
    if is_prime:
        show n
    n = n + 1

end
