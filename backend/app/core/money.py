"""Decimal helpers. Never use float for money or nights."""

from decimal import ROUND_HALF_UP, Decimal, getcontext

getcontext().rounding = ROUND_HALF_UP

CENT = Decimal("0.01")
HALF_NIGHT = Decimal("0.5")
ZERO = Decimal("0")


def money(value: Decimal | int | str) -> Decimal:
    """Quantise to 2dp with ROUND_HALF_UP."""
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def nights(value: Decimal | int | str) -> Decimal:
    return Decimal(value).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)


def round_to_half_night(value: Decimal, mode: str = "DOWN") -> Decimal:
    """Round nights to the nearest 0.5 night.

    mode: DOWN (member-unfavourable, default for credits), UP, or HALF_UP.
    The mode is a configuration value (cancellation_tiers.rounding_mode).
    """
    doubled = value * 2
    if mode == "UP":
        q = doubled.to_integral_value(rounding="ROUND_CEILING")
    elif mode == "HALF_UP":
        q = doubled.to_integral_value(rounding=ROUND_HALF_UP)
    else:
        q = doubled.to_integral_value(rounding="ROUND_FLOOR")
    return nights(q / 2)


def format_inr(amount: Decimal) -> str:
    """Indian digit grouping: 255000 -> ₹2,55,000.00."""
    amount = money(amount)
    sign = "-" if amount < 0 else ""
    whole, frac = f"{abs(amount):.2f}".split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups: list[str] = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join([*groups, tail])
    return f"{sign}₹{whole}.{frac}"


def format_money(amount: Decimal, currency: str = "INR") -> str:
    """INR with ₹ and Indian grouping (₹2,55,000.00); any other currency by its code (USD 2,550.00).

    Currencies are never added together, so each amount is shown in its own currency.
    """
    if currency == "INR":
        return format_inr(amount)
    amount = money(amount)
    sign = "-" if amount < 0 else ""
    return f"{sign}{currency} {abs(amount):,.2f}"
