"""Safety flagging — port of lib/server/safety.ts.

Two silent signals file an account flag for admin review when
someone asks the AI for seriously harmful or illegal help: a
high-confidence harmful-request pattern in the user's own
message (intent + object), or a safety refusal from the
answering model. A flag never affects the user. Keep the
patterns in sync with the TS module.
"""
from __future__ import annotations

import re
import time

_INTENT = re.compile(
    r"\b(how\s+to|how\s+do\s+i|how\s+can\s+i|instructions?\s+(for|to)|tutorial|guide\s+to|recipe\s+for|steps\s+to|ways?\s+to|teach\s+me|show\s+me\s+how|make|build|create|construct|cook|synthesize|manufacture|write|generate|get\s+away\s+with)\b",
    re.IGNORECASE,
)

_CATEGORY_OBJECTS: list[tuple[str, re.Pattern]] = [
    (
        "weapons",
        re.compile(
            r"\b(pipe\s+bomb|pressure\s+cooker\s+bomb|bomb|explosive\s+device|grenade|landmine|molotov|detonator|silencer|chemical\s+weapon|nerve\s+(gas|agent)|sarin|ricin|anthrax|tnt|napalm|improvised\s+explosive|ied)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "illicit-drugs",
        re.compile(
            r"\b(methamphetamine|meth|heroin|fentanyl|cocaine|crack\s+cocaine|lsd|drug\s+lab)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "cybercrime",
        re.compile(
            r"\b(hack\s+into|hacking\s+into|bypass\s+(a\s+|the\s+|someone'?s\s+)?(password|login|2fa|two[\s-]factor|security)|steal\s+(passwords?|credentials?|accounts?|sessions?|cookies?)|phishing\s+(page|site|email|kit|attack)|keylogger|ransomware|malware|ddos|brute[\s-]force\s+(attack|password|login)|crack\s+(a\s+|the\s+|someone'?s\s+)?(password|account|wifi)|carding|credit\s+card\s+dumps?|botnet)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "fraud",
        re.compile(
            r"\b(fake\s+(id|passport|documents?|currency|money|bills?)|counterfeit\s+(money|currency|bills?|documents?)|money\s+laundering|launder\s+money|forge\s+(a\s+|the\s+)?(signature|documents?|passport)|scam\s+(people|users|customers|victims)|ponzi|steal\s+money\s+from)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "violent-wrongdoing",
        re.compile(
            r"\b(kill\s+(a\s+person|someone|my\s+\w+|him|her|them)|murder\s+(a\s+person|someone|my\s+\w+|him|her|them)|poison\s+(a\s+person|someone|my\s+\w+|him|her|them)|strangle|assassinate|get\s+away\s+with\s+(murder|a\s+crime|killing))\b",
            re.IGNORECASE,
        ),
    ),
]

_MINOR_INDICATOR = re.compile(
    r"\b(child|children|minor|underage|preteen|pre-teen|schoolgirl|schoolboy|young\s+girl|young\s+boy|1[0-7]\s*(years?[\s-]?old|yo|y/o))\b",
    re.IGNORECASE,
)
_SEXUAL_TERMS = re.compile(
    r"\b(sex|sexual|nude|naked|porn|erotic|nsfw|undress|explicit)\b",
    re.IGNORECASE,
)

_SAFETY_REFUSAL_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\bi (?:can'?t|cannot|can not|won'?t|will not) (?:help|assist|comply|provide|generate|create|write|give)\b[^.]{0,80}\b(?:illegal|harmful|dangerous|weapon|drug|hack|fraud|violent|violence|exploit|wrongdoing|policy|guideline|unethical)",
        r"\bi (?:can'?t|cannot|can not) (?:help|assist) with (?:that|this)\b",
        r"\b(?:against|violates?|violation of) (?:my|our|the) (?:policy|policies|guidelines|terms)\b",
        r"\bi'?m (?:not able|unable) to (?:help|assist|provide|comply)\b[^.]{0,60}\b(?:illegal|harmful|dangerous)",
        r"\bthis (?:request|content) (?:is|involves?)\b[^.]{0,30}\b(?:illegal|harmful|dangerous|disallowed)\b",
        r"\bi must decline\b",
        r"\bi (?:can'?t|cannot|can not) fulfill (?:this|that|your) request\b",
        r"\bi (?:can'?t|cannot|can not) provide (?:instructions|guidance|information)\b[^.]{0,60}\b(?:illegal|harmful|dangerous|weapon|drug|harm)",
    )
]


def classify_harmful_request(text: str) -> str | None:
    """The category of a high-confidence harmful request, else None."""
    sample = text[:4000]
    if _MINOR_INDICATOR.search(sample) and _SEXUAL_TERMS.search(sample):
        return "sexual-exploitation"
    if not _INTENT.search(sample):
        return None
    scrubbed = re.sub(r"\bbath\s+bombs?\b", "cosmetic", sample, flags=re.IGNORECASE)
    for category, objects in _CATEGORY_OBJECTS:
        target = scrubbed if category == "weapons" else sample
        if objects.search(target):
            return category
    return None


def looks_like_safety_refusal(text: str) -> bool:
    head = text[:500].lower()
    return any(pattern.search(head) for pattern in _SAFETY_REFUSAL_PATTERNS)


def write_flag(db, *, uid: str, chat_id: str, prompt: str, category: str, signal: str, model: str | None) -> None:
    from firebase_admin import firestore

    db.collection("safetyFlags").add(
        {
            "uid": uid,
            "chatId": chat_id,
            "prompt": prompt[:500],
            "category": category,
            "signal": signal,
            "model": model,
            "status": "pending",
            "ts": int(time.time() * 1000),
            "createdAt": firestore.SERVER_TIMESTAMP,
        }
    )
