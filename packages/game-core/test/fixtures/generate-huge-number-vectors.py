#!/usr/bin/env python3
"""
Regenerates huge-number-vectors.json from an independent oracle.

The expected value of every golden vector is computed with Python's `decimal`
module — not with the TypeScript implementation under test — so the vectors
check HugeNumber against a second, unrelated implementation of decimal
arithmetic (ADR-013, section 6).

Semantics modelled here, exactly as ADR-013 specifies them:

- 18 significant digits, ROUND_HALF_EVEN, one rounding per operation;
- the exponent range is checked AFTER rounding: a scientific exponent above
  2^31 - 1 is OVERFLOW, below -(2^31 - 1) flushes to zero (no subnormals);
- `pow` is square-and-multiply, least significant bit first, rounding after
  every multiplication, without squaring after the last bit;
- `floor` rounds toward negative infinity.

Python is not a project dependency and this script does not run in CI. Run it
by hand after a deliberate rules change, review the diff, and bump
GAME_RULES_VERSION:

    python3 packages/game-core/test/fixtures/generate-huge-number-vectors.py
"""

import json
from decimal import (
    MAX_EMAX,
    MIN_EMIN,
    ROUND_FLOOR,
    ROUND_HALF_EVEN,
    Context,
    Decimal,
)
from pathlib import Path

PRECISION = 18
MAX_EXPONENT = 2**31 - 1
MIN_EXPONENT = -(2**31 - 1)

# Unbounded exponent range: rounding happens here, range checks happen below.
CTX = Context(prec=PRECISION, rounding=ROUND_HALF_EVEN, Emax=MAX_EMAX, Emin=MIN_EMIN, traps=[])
EXACT = Context(prec=10_000, rounding=ROUND_HALF_EVEN, Emax=MAX_EMAX, Emin=MIN_EMIN, traps=[])


class Overflow(Exception):
    pass


def check_range(value: Decimal) -> Decimal:
    if value.is_zero():
        return Decimal(0)
    if value.adjusted() > MAX_EXPONENT:
        raise Overflow()
    if value.adjusted() < MIN_EXPONENT:
        return Decimal(0)
    return value


def canonical(value: Decimal) -> str:
    if value.is_zero():
        return "0"
    sign, digits, _ = value.normalize(EXACT).as_tuple()
    text = "".join(str(d) for d in digits)
    fraction = text[1:].rstrip("0")
    return ("-" if sign else "") + text[0] + ("." + fraction if fraction else "") + "e" + str(value.adjusted())


def operand(text: str) -> Decimal:
    """Operands must already be representable, so a vector tests one rounding."""
    exact = Decimal(text)
    rounded = check_range(CTX.plus(exact))
    assert rounded == exact, f"operand {text} is not an exact HugeNumber"
    return rounded


def power(base: Decimal, exponent: int) -> Decimal:
    result = Decimal(1)
    remaining = exponent
    while remaining > 0:
        if remaining % 2 == 1:
            result = check_range(CTX.multiply(result, base))
        remaining //= 2
        if remaining > 0:
            base = check_range(CTX.multiply(base, base))
    return result


def run(op: str, a: str, b: str | None) -> dict:
    try:
        if op == "fromDecimal":
            value = check_range(CTX.plus(Decimal(a)))
        elif op == "add":
            value = check_range(CTX.add(operand(a), operand(b)))
        elif op == "sub":
            value = check_range(CTX.subtract(operand(a), operand(b)))
        elif op == "mul":
            value = check_range(CTX.multiply(operand(a), operand(b)))
        elif op == "div":
            divisor = operand(b)
            if divisor.is_zero():
                return {"error": "DIVISION_BY_ZERO"}
            value = check_range(CTX.divide(operand(a), divisor))
        elif op == "pow":
            value = power(operand(a), int(b))
        elif op == "floor":
            value = check_range(operand(a).to_integral_value(rounding=ROUND_FLOOR, context=EXACT))
        else:
            raise ValueError(op)
    except Overflow:
        return {"error": "OVERFLOW"}
    return {"expected": canonical(value)}


MAX = "9.99999999999999999e2147483647"
TINY = "1e-2147483647"

CASES = [
    # --- parsing: exact decimal input, one rounding, then the range check -----
    ("fromDecimal", "0", None),
    ("fromDecimal", "-0", None),
    ("fromDecimal", "0.000", None),
    ("fromDecimal", "1500", None),
    ("fromDecimal", "0.25", None),
    ("fromDecimal", "1.070", None),
    ("fromDecimal", "000123", None),
    ("fromDecimal", "-42", None),
    ("fromDecimal", "+7", None),
    ("fromDecimal", ".5", None),
    ("fromDecimal", "2.5E-3", None),
    ("fromDecimal", "9007199254740993", None),
    ("fromDecimal", "999999999999999999", None),
    ("fromDecimal", "1234567890123456789", None),  # 19 digits, rounds up
    ("fromDecimal", "1234567890123456785", None),  # tie, even stays
    ("fromDecimal", "1234567890123456775", None),  # tie, odd rounds up
    ("fromDecimal", "1234567890123456785000000001", None),  # just above tie
    ("fromDecimal", "9999999999999999995", None),  # tie carries into next decade
    ("fromDecimal", "-9999999999999999995", None),
    ("fromDecimal", "0.1234567890123456785", None),
    ("fromDecimal", "1e2147483647", None),
    ("fromDecimal", "1e2147483648", None),  # overflow
    ("fromDecimal", "9.999999999999999995e2147483647", None),  # rounds into overflow
    ("fromDecimal", "9.999999999999999994e2147483647", None),
    ("fromDecimal", "1e-2147483647", None),
    ("fromDecimal", "1e-2147483648", None),  # underflow flushes to zero
    ("fromDecimal", "9.999999999999999995e-2147483648", None),  # rounds up into range
    ("fromDecimal", "-1e-2147483648", None),
    ("fromDecimal", "1e-999999999999", None),
    # --- addition -------------------------------------------------------------
    ("add", "0", "0"),
    ("add", "0", "1.5e3"),
    ("add", "-2.5e-1", "0"),
    ("add", "1e0", "1e0"),
    ("add", "1.234567e6", "1e0"),
    ("add", "9.99999999999999999e17", "1e0"),  # exact carry to 1e18
    ("add", "9.99999999999999999e17", "2e0"),  # 19 digits, rounds down
    ("add", "1e18", "5e0"),  # tie, even stays
    ("add", "1.00000000000000001e18", "5e0"),  # tie, odd rounds up
    ("add", "1e18", "6e0"),
    ("add", "9.99999999999999999e5", "5e-13"),  # tie carries into next decade
    ("add", "1e20", "1e0"),  # widest exact window
    ("add", "1e21", "1e0"),  # beyond the window
    ("add", "1e21", "9.99999999999999999e0"),
    ("add", "1.5e21", "5e2"),
    ("add", "1e38", "1e17"),
    ("add", "1e2147483647", "1e-2147483647"),
    ("add", "-5e0", "3e0"),
    ("add", "3e0", "-5e0"),
    ("add", "-1.5e3", "-2.5e3"),
    ("add", "1.23456789012345678e0", "-1.23456789012345678e0"),
    ("add", "1e2147483647", "1e2147483647"),
    ("add", MAX, "1e2147483630"),  # overflow
    ("add", MAX, "4e2147483629"),  # rounds back down: no overflow
    ("add", "-" + MAX, "-1e2147483630"),  # negative overflow
    ("add", "1.5e-2147483647", "-1e-2147483647"),  # underflow to zero
    # --- subtraction ----------------------------------------------------------
    ("sub", "0", "0"),
    ("sub", "0", "7e0"),
    ("sub", "1e0", "1e0"),
    ("sub", "1.00000000000000001e0", "1e0"),  # catastrophic cancellation is exact
    ("sub", "1e18", "1e0"),
    ("sub", "1e19", "1e0"),  # 19 nines rounds back up
    ("sub", "1e21", "1e0"),
    ("sub", "1e20", "1e0"),
    ("sub", "1e20", "5e1"),
    ("sub", "1e0", "1e-18"),  # tie below a decade boundary
    ("sub", "1e0", "1.5e-18"),
    ("sub", "3e0", "5e0"),
    ("sub", "-3e0", "-5e0"),
    ("sub", "1.23456789012345678e40", "1.23456789012345677e40"),
    ("sub", "2e-2147483647", "1e-2147483647"),
    ("sub", "1.1e-2147483647", "1e-2147483647"),  # underflow to zero
    ("sub", MAX, "-1e2147483630"),  # overflow
    # --- multiplication -------------------------------------------------------
    ("mul", "0", "5e0"),
    ("mul", "-5e0", "0"),
    ("mul", "1e0", "1.23456789012345678e9"),
    ("mul", "1.23456789e8", "9.87654321e8"),
    ("mul", "1e9", "1e9"),
    ("mul", "3e0", "3.33333333333333333e-1"),
    ("mul", "9.99999999999999999e17", "9.99999999999999999e17"),
    ("mul", "1.00000000000000001e0", "1.5e0"),  # tie, odd rounds up
    ("mul", "1.00000000000000003e0", "1.5e0"),  # tie, even stays
    ("mul", "1.07e0", "1.07e0"),
    ("mul", "-2e0", "3e0"),
    ("mul", "-2e0", "-3e0"),
    ("mul", "4.294967296e9", "4.294967296e9"),
    ("mul", "1e1073741824", "1e1073741823"),
    ("mul", "3.16227766016837933e1073741823", "3.16227766016837933e1073741823"),
    ("mul", "1e2000000000", "1e2000000000"),  # overflow
    ("mul", "-1e2000000000", "1e2000000000"),  # negative overflow
    ("mul", "1e-2000000000", "1e-2000000000"),  # underflow to zero
    ("mul", "1e-1073741824", "1e-1073741823"),
    # --- division -------------------------------------------------------------
    ("div", "0", "5e0"),
    ("div", "5e0", "0"),
    ("div", "1e0", "3e0"),
    ("div", "2e0", "3e0"),
    ("div", "1e0", "7e0"),
    ("div", "1e1", "4e0"),
    ("div", "1e0", "8e0"),
    ("div", "-1e0", "3e0"),
    ("div", "1e0", "-3e0"),
    ("div", "-6e0", "-3e0"),
    ("div", "3.00000000000000001e0", "2e0"),  # tie, even stays
    ("div", "3.00000000000000003e0", "2e0"),  # tie, odd rounds up
    ("div", "9.99999999999999999e17", "1e17"),
    ("div", "1e0", "9.99999999999999999e0"),
    ("div", "9.99999999999999999e0", "1e0"),
    ("div", "1.23456789012345678e40", "8.76543210987654321e-12"),
    ("div", TINY, "1e10"),  # underflow to zero
    ("div", "1e2147483647", "1e-1"),  # overflow
    ("div", "1e2147483647", "1e0"),
    ("div", TINY, "1e0"),
    # --- integer power (square-and-multiply) ----------------------------------
    ("pow", "2e0", "0"),
    ("pow", "0", "0"),
    ("pow", "0", "5"),
    ("pow", "7e0", "1"),
    ("pow", "2e0", "10"),
    ("pow", "2e0", "59"),
    ("pow", "2e0", "64"),
    ("pow", "3e0", "40"),
    ("pow", "1.07e0", "100"),
    ("pow", "1.15e0", "1000"),
    ("pow", "1.15e0", "999999"),
    ("pow", "-2e0", "3"),
    ("pow", "-2e0", "4"),
    ("pow", "1e1", "2147483647"),
    ("pow", "1e1", "2147483648"),  # overflow
    ("pow", "1e-1", "2147483647"),
    ("pow", "1e-1", "2147483648"),  # underflow to zero
    ("pow", "1.1e0", "9007199254740991"),  # overflow long before the last bit
    ("pow", "1.00000000000000001e0", "9007199254740991"),
    ("pow", "5e-1", "3"),
    # --- floor ----------------------------------------------------------------
    ("floor", "0", None),
    ("floor", "1.5e0", None),
    ("floor", "-1.5e0", None),
    ("floor", "5e-1", None),
    ("floor", "-5e-1", None),
    ("floor", "1.23456e2", None),
    ("floor", "-1.23456e2", None),
    ("floor", "-3e0", None),
    ("floor", "9.99999999999999999e17", None),
    ("floor", "9.99999999999999999e16", None),
    ("floor", "-9.99999999999999999e16", None),
    ("floor", "-9.99999999999999999e-1", None),
    ("floor", "1.23456789012345678e40", None),
    ("floor", TINY, None),
    ("floor", "-" + TINY, None),
]


def main() -> None:
    vectors = []
    for op, a, b in CASES:
        vector = {"op": op, "a": a}
        if b is not None:
            vector["b"] = b
        vector.update(run(op, a, b))
        vectors.append(vector)

    output = {
        "description": "HugeNumber golden vectors (ADR-013). Expected values are computed by "
        "generate-huge-number-vectors.py with Python's decimal module, an implementation "
        "independent of the code under test. Changing a vector is a rules change: bump "
        "GAME_RULES_VERSION.",
        "precision": PRECISION,
        "rounding": "ROUND_HALF_EVEN",
        "vectors": vectors,
    }
    target = Path(__file__).with_name("huge-number-vectors.json")
    target.write_text(json.dumps(output, indent=2) + "\n")
    print(f"wrote {len(vectors)} vectors to {target}")


if __name__ == "__main__":
    main()
