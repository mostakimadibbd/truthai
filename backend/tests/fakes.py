"""In-memory fakes for the Firestore/RTDB surface chatjob uses,
so the full job lifecycle can be tested without credentials."""
from __future__ import annotations

import copy
import datetime


class FakeSnapshot:
    def __init__(self, data):
        self._data = data

    @property
    def exists(self):
        return self._data is not None

    def to_dict(self):
        return copy.deepcopy(self._data) if self._data else None


class FakeDocRef:
    def __init__(self, store: dict, path: str):
        self._store = store
        self._path = path

    def collection(self, name: str) -> "FakeCollection":
        return FakeCollection(self._store, f"{self._path}/{name}")

    def get(self) -> FakeSnapshot:
        return FakeSnapshot(self._store.get(self._path))

    def set(self, data: dict, merge: bool = False):
        if merge and self._path in self._store:
            self._store[self._path] = {**self._store[self._path], **_resolve(data)}
        else:
            self._store[self._path] = _resolve(data)

    def update(self, data: dict):
        if self._path not in self._store:
            raise KeyError(f"document does not exist: {self._path}")
        self._store[self._path] = {**self._store[self._path], **_resolve(data)}

    def delete(self):
        self._store.pop(self._path, None)


class FakeQuery:
    def __init__(self, store: dict, prefix: str):
        self._store = store
        self._prefix = prefix
        self._limit = None
        self._limit_to_last = False
        self._filters: list = []

    def limit(self, n: int) -> "FakeQuery":
        self._limit = n
        self._limit_to_last = False
        return self

    def limit_to_last(self, n: int) -> "FakeQuery":
        self._limit = n
        self._limit_to_last = True
        return self

    def where(self, field: str, op: str, value) -> "FakeQuery":
        # Parity: the real client supports field filters on
        # queries; only equality is modelled (all the app uses).
        if op != "==":
            raise ValueError(f"FakeQuery only models == filters, got {op}")
        self._filters.append((field, value))
        return self

    def _select(self) -> list:
        paths = sorted(
            p for p in self._store if p.startswith(self._prefix + "/")
            and p.count("/") == self._prefix.count("/") + 1
        )
        snapshots = [FakeSnapshot(self._store[path]) for path in paths]
        for field, value in self._filters:
            snapshots = [
                snap
                for snap in snapshots
                if (snap.to_dict() or {}).get(field) == value
            ]
        if self._limit:
            snapshots = snapshots[-self._limit:] if self._limit_to_last else snapshots[: self._limit]
        return snapshots

    def stream(self):
        # Parity with the real client: streaming a limit_to_last
        # query is a hard error there — the fake must refuse too,
        # or tests pass while production dies (this exact gap hid
        # the chatjob history bug until it hit real users).
        if self._limit_to_last:
            raise ValueError(
                "Query results for queries that include limit_to_last() "
                "constraints cannot be streamed. Use Query.get() instead."
            )
        yield from self._select()

    def get(self) -> list:
        return self._select()


class FakeCollection:
    def __init__(self, store: dict, path: str):
        self._store = store
        self._path = path

    def document(self, doc_id: str | None = None) -> FakeDocRef:
        if doc_id is None:
            doc_id = f"auto{len(self._store)}"
        return FakeDocRef(self._store, f"{self._path}/{doc_id}")

    def order_by(self, _field: str, direction=None) -> FakeQuery:
        return FakeQuery(self._store, self._path)

    # Parity: in the real client a Collection IS a Query, so
    # limit/where/get/stream are available directly on it.
    def limit(self, n: int) -> FakeQuery:
        return FakeQuery(self._store, self._path).limit(n)

    def where(self, field: str, op: str, value) -> FakeQuery:
        return FakeQuery(self._store, self._path).where(field, op, value)

    def get(self) -> list:
        return FakeQuery(self._store, self._path).get()

    def stream(self):
        return FakeQuery(self._store, self._path).stream()


class FakeBatch:
    def __init__(self, store: dict):
        self._store = store
        self._ops: list = []

    def create(self, ref: FakeDocRef, data: dict):
        self._ops.append(("set", ref, data, False))

    def set(self, ref: FakeDocRef, data: dict, merge: bool = False):
        self._ops.append(("set", ref, data, merge))

    def update(self, ref: FakeDocRef, data: dict):
        self._ops.append(("update", ref, data, False))

    def commit(self):
        for kind, ref, data, merge in self._ops:
            if kind == "set":
                ref.set(data, merge=merge)
            else:
                ref.update(data)


class FakeFirestore:
    def __init__(self):
        self.store: dict[str, dict] = {}

    def collection(self, name: str) -> FakeCollection:
        return FakeCollection(self.store, name)

    def batch(self) -> FakeBatch:
        return FakeBatch(self.store)


class FakeRtdbRef:
    def __init__(self, store: dict, path: str):
        self._store = store
        self._path = path

    def set(self, payload: dict):
        self._store[self._path] = copy.deepcopy(payload)

    def delete(self):
        self._store.pop(self._path, None)


def make_rtdb(store: dict):
    return lambda path: FakeRtdbRef(store, path)


def _resolve(data: dict) -> dict:
    """Replace server-timestamp sentinels with a fixed datetime,
    and increment/array-union sentinels with computed values."""
    resolved = {}
    for key, value in data.items():
        if _is_server_timestamp(value):
            resolved[key] = datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)
        elif _is_increment(value):
            resolved[key] = value  # tests assert on the sentinel's amount via repr
        else:
            resolved[key] = value
    return resolved


def _is_server_timestamp(value) -> bool:
    return type(value).__name__ == "Sentinel" and "SERVER_TIMESTAMP" in repr(value)


def _is_increment(value) -> bool:
    return type(value).__name__ in ("Increment", "_Increment")
