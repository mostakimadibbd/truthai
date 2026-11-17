"""Long-term AI memory — port of lib/server/memory.ts.

Facts live at users/{uid}/memories (server-written only). The
model saves new durable facts by ending a reply with hidden
[[memory: …]] markers; the executor strips them from everything
stored or streamed and persists the facts. The memoryEnabled
preference (users/{uid}/settings/preferences) gates both recall
and capture. Sync Firestore calls — callers wrap in _run_sync.
"""
from __future__ import annotations

import re

MEMORY_LIMIT = 100
MEMORY_TEXT_MAX = 200
MEMORY_INJECT_MAX_CHARS = 2400

_MARKER = re.compile(r"\[\[memory:\s*([^\]]{1,240})\]\]", re.IGNORECASE)


# Categories that must NEVER be stored as memories (parity with
# lib/server/memory.ts): health, finances, government/financial
# identifiers, and credentials or secrets.
_SENSITIVE_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\b(password|passcode|api[\s_-]?key|secret[\s_-]?key|access[\s_-]?token|credential)s?\b",
        r"\bmy\s+(password|pin|passcode)\b",
        r"\bpin\s*(is|:|=)\s*\d",
        r"\b\d{3}-\d{2}-\d{4}\b",
        r"\b(?:\d[ -]?){13,19}\b",
        r"\b(passport|national\s+id|driver'?s\s+licen[cs]e|tax\s+id|social\s+security|ssn)\b",
        r"\b(bank\s+account|account\s+number|routing\s+number|iban|sort\s+code|credit\s+card|debit\s+card)\b",
        r"\b(salary|wages|income|paycheck)\b[^.]{0,40}(\$|€|£|\d)",
        r"\b(earns|makes|owes|debt\s+of|loan\s+of|borrowed)\b[^.]{0,30}(\$|€|£|\d)",
        r"\bbank\s+balance\b",
        r"\b(diagnosed|diagnosis|diabetes|cancer|hiv|aids|epilepsy|hypertension|blood\s+pressure|chemotherapy|prescription|medication|dosage|pregnan\w+|mental\s+health|depression|anxiety\s+disorder|adhd|autism)\b",
        r"\b\d+\s?(mg|mcg)\b[^.]{0,30}\b(daily|twice|once|tablet|dose|pill)\b",
    )
]


def is_sensitive_memory(text: str) -> bool:
    return any(pattern.search(text) for pattern in _SENSITIVE_PATTERNS)


def sanitize_memory_text(value: object) -> str:
    if not isinstance(value, str):
        return ""
    text = value.replace("[[", "").replace("]]", "")
    text = re.sub(r"\s+", " ", text).strip()
    return text[:MEMORY_TEXT_MAX]


def normalize_memory_key(text: str) -> str:
    lowered = re.sub(r"[^a-z0-9 ]", "", text.lower())
    return re.sub(r"\s+", " ", lowered).strip()


def extract_memories(text: str) -> tuple[str, list[str]]:
    memories: list[str] = []

    def _take(match: re.Match) -> str:
        clean = sanitize_memory_text(match.group(1))
        if clean:
            memories.append(clean)
        return ""

    clean_text = _MARKER.sub(_take, text)
    clean_text = re.sub(r"[ \t]+\n", "\n", clean_text)
    clean_text = re.sub(r"\n{3,}", "\n\n", clean_text).rstrip()
    return clean_text, memories


def live_visible_text(text: str) -> str:
    clean_text, _ = extract_memories(text)
    tail_start = clean_text.rfind("[[")
    if tail_start >= 0 and "]]" not in clean_text[tail_start:]:
        return clean_text[:tail_start].rstrip()
    return clean_text


def memory_system_block(memories: list[str]) -> str:
    facts = "\n".join(f"- {text}" for text in memories)[:MEMORY_INJECT_MAX_CHARS]
    return "\n".join(
        [
            "Long-term memory — things you remember about this user from earlier conversations. Use them naturally when relevant; never recite the list unprompted:",
            facts or "(nothing saved yet)",
            "When you learn a NEW durable fact about the user that would help future conversations (their name, work, projects, preferences, important people, goals, constraints), save it by ending your reply with a line [[memory: the fact in one short sentence]]. At most two per reply, only genuinely durable facts — never temporary details, never anything already listed above, and never mention this mechanism or the markers to the user. NEVER save health information, financial details, ID or account numbers, passwords, PINs or any other credentials or secrets, even if the user mentions them.",
        ]
    )


def memory_enabled(db, uid: str) -> bool:
    try:
        snap = (
            db.collection("users")
            .document(uid)
            .collection("settings")
            .document("preferences")
            .get()
        )
        if snap.exists:
            data = snap.to_dict() or {}
            value = data.get("memoryEnabled")
            if isinstance(value, bool):
                return value
    except Exception:
        pass
    return True


def load_memories(db, uid: str) -> list[str]:
    snaps = (
        db.collection("users")
        .document(uid)
        .collection("memories")
        .order_by("createdAt", direction="DESCENDING")
        .limit(MEMORY_LIMIT)
        .stream()
    )
    texts: list[str] = []
    for snap in snaps:
        data = snap.to_dict() or {}
        text = data.get("text")
        if isinstance(text, str) and text:
            texts.append(text)
    return texts


def save_memories(db, uid: str, facts: list[str], chat_id: str | None = None) -> list[dict]:
    """Save facts (duplicates + sensitive categories filtered);
    returns the saved entries [{id, text}] for the UI chip."""
    from firebase_admin import firestore

    clean = [sanitize_memory_text(fact) for fact in facts]
    clean = [text for text in clean if text and not is_sensitive_memory(text)]
    if not clean:
        return []
    ref = db.collection("users").document(uid).collection("memories")
    existing = list(ref.limit(MEMORY_LIMIT).stream())
    seen = {
        normalize_memory_key(str((snap.to_dict() or {}).get("text") or ""))
        for snap in existing
    }
    saved: list[dict] = []
    for text in clean:
        if len(existing) + len(saved) >= MEMORY_LIMIT:
            break
        key = normalize_memory_key(text)
        if not key or key in seen:
            continue
        seen.add(key)
        doc: dict = {"text": text, "source": "auto", "createdAt": firestore.SERVER_TIMESTAMP}
        if chat_id:
            doc["chatId"] = chat_id
        result = ref.add(doc)
        doc_ref = result[1] if isinstance(result, tuple) else result
        saved.append({"id": getattr(doc_ref, "id", ""), "text": text})
    return saved
