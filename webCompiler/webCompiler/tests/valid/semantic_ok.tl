start
total: int = 0
ratio: float = 2
function add(a: int, b: int) -> int:
    result: int = a + b
    return result
total = add(10, 20)
i: int = 1
while i <= 3:
    show i
    i = i + 1
for k in 1 to 2:
    show k
x: int
if total > 5:
    x = 1
else:
    x = 2
show x
show ratio * 2
show total % 4 == 2 and not false
end
