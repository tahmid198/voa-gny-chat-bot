"""Deterministic answers for PTO accrual questions.

The handbook states PTO as a table. Asking a 1B model to read a table out of
retrieved text is where it hallucinates, so the rows are parsed directly and
the model is skipped when the parse succeeds.

Ported from rag_chat.py's answer_pto_question(), with two corrections:
  * ordinal suffixes are generated properly (2nd/3rd/21st, not 2th/21th)
  * the answer cites the chunk the table was parsed from, so the [n] citation
    in the UI links to a real source
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# (regex, year the tier starts, workdays, hours) exactly as the handbook lists.
TIER_PATTERNS: list[tuple[str, int, int, int]] = [
    (r"8\.67\s+hours per month.*?104 hours.*?13 workdays", 1, 13, 104),
    (r"10\.67\s+hours per month.*?128 hours.*?16 workdays", 2, 16, 128),
    (r"12\.67\s+hours per month.*?152 hours.*?19 workdays", 3, 19, 152),
    (r"14\.67\s+hours per month.*?172 hours.*?22 workdays", 4, 22, 172),
    (r"16\.00\s+hours per month.*?192 hours.*?24 workdays", 6, 24, 192),
    (r"17\.33\s+hours per month.*?208 hours.*?26 workdays", 11, 26, 208),
    (r"18\.67\s+hours per month.*?224 hours.*?28 workdays", 16, 28, 224),
    (r"20\.00\s+hours per month.*?240 hours.*?30 workdays", 21, 30, 240),
    (r"21\.33\s+hours per month.*?256 hours.*?32 workdays", 26, 32, 256),
    (r"22\.67\s+hours per month.*?272 hours.*?34 workdays", 31, 34, 272),
]

_YEAR_RE = re.compile(r"\b(\d+)\s*(?:st|nd|rd|th)?\s+year\b")
_AFTER_RE = re.compile(r"after\s+(\d+)\s+years?")


@dataclass
class Tier:
    year: int
    days: int
    hours: int


def ordinal(n: int) -> str:
    """1 -> 1st, 2 -> 2nd, 11 -> 11th, 21 -> 21st."""
    if 10 <= n % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def parse_tiers(text: str) -> list[Tier]:
    """Pull every accrual row present in the given text."""
    lowered = text.lower()

    # Cheap guard: without the table's column headers this is prose, not the
    # accrual table, and the tier regexes would be matching across sections.
    if "workdays per year" not in lowered and "hours per month" not in lowered:
        return []

    tiers = [
        Tier(year, days, hours)
        for pattern, year, days, hours in TIER_PATTERNS
        if re.search(pattern, lowered, re.DOTALL)
    ]
    return sorted(tiers, key=lambda tier: tier.year)


def requested_year(question: str) -> int | None:
    """Work out which year of employment the question is about."""
    lowered = question.lower()

    if "first year" in lowered:
        return 1

    # "after 10 years" means the employee is now in their 11th year.
    after = _AFTER_RE.search(lowered)
    if after:
        return int(after.group(1)) + 1

    year = _YEAR_RE.search(lowered)
    if year:
        return int(year.group(1))

    return None


def applicable_tier(tiers: list[Tier], year: int) -> Tier | None:
    """The highest tier whose starting year the employee has reached."""
    reached = [tier for tier in tiers if year >= tier.year]
    return reached[-1] if reached else None


def answer(question: str, hits) -> str | None:
    """Return a deterministic PTO answer, or None to fall through to the LLM.

    `hits` are the retrieved chunks in the order they appear in the context,
    so the index of the matching chunk is also its citation number.
    """
    tiers: list[Tier] = []
    citation: int | None = None

    for position, hit in enumerate(hits, start=1):
        parsed = parse_tiers(hit.text)
        if len(parsed) > len(tiers):
            tiers = parsed
            citation = position

    if not tiers:
        return None

    marker = f" [{citation}]" if citation else ""
    year = requested_year(question)

    if year is not None:
        tier = applicable_tier(tiers, year)
        if tier:
            return (
                f"According to the VOA-Greater New York Employee Handbook, "
                f"employees receive {tier.days} workdays ({tier.hours} hours) of "
                f"PTO per year beginning in their {ordinal(tier.year)} year of "
                f"employment.{marker}"
            )

    lines = [f"The PTO accrual schedule in the handbook is:{marker}"]
    lines.extend(
        f"- {ordinal(tier.year)} year: {tier.days} workdays ({tier.hours} hours)"
        for tier in tiers
    )
    return "\n".join(lines)
