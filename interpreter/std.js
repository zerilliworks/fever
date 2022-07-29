module.exports = {
    fevers: [
        "len a = a \\> 0 $ + 1",
        "? true b c = b",
        "? false b c = c",
        "idx a i = a \\> 0 ? i == # @ $",
        "hd a = ? > len a 0 idx a 0 false",
        "tl a = a ~> # > 0",
        "last a = idx a ((len a) - 1)",
        "set a i v = a -> ? i == # v @",
        "rev a = a -> idx a ((len a) - (#+1))",
        "fib 0 = 0",
        "fib 1 = 1",
        "fib n = (fib (n-1)) + (fib (n-2))",
        "square n = n * n",
        "pow a 0 = 1",
        "pow a b = a * pow a b - 1",
        "powi a b = arr b a \\> 1 ($ * @)",
        "interpret prompt = cast take prompt",
        "@i_rand_range low high = diff = high - low ; (floor (diff * random)) + low",
        "! true = false",
        "! false = true",
        "champ a = a \\> ninf ? @ > $ @ $",
        "del a i = a ~> ! @ == i",
        "sel a i = a ~> @ == i",
        "sort [] = []",
        "sort a = (sort del a champ a) + (sel a champ a)"
    ]
}