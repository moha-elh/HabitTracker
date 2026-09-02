import pytest
from pydantic import ValidationError

from pipeline.contract import CONTRACT_VERSION, Extraction

VALID = {
    "contract_version": CONTRACT_VERSION,
    "year": 2026,
    "month": 8,
    "habits": [
        {"name": "Read", "kind": "build", "sort_order": 0},
        {"name": "No sugar", "kind": "eliminate", "sort_order": 1},
    ],
    "cells": [
        {"day": 1, "habit": "Read", "status": "done", "confidence": 0.98},
        {"day": 1, "habit": "No sugar", "status": "missed", "confidence": 0.7},
        {"day": 2, "habit": "Read", "status": "empty", "confidence": 1.0},
    ],
    "sleep": [{"day": 1, "hours": 7.5, "confidence": 1.0}],
    "moments": [{"day": 1, "weekday": "Sat", "text": "Visited the mosque.", "lang": "en"}],
    "flags": [{"day": 2, "reason": "grid total 3 != drawn red line 4"}],
}


def test_valid_round_trips():
    ex = Extraction.model_validate(VALID)
    assert ex.model_dump(mode="json") == VALID


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.update(month=13),
        lambda d: d["cells"][0].update(day=0),
        lambda d: d["cells"][0].update(day=32),
        lambda d: d["cells"][0].update(confidence=1.5),
        lambda d: d["habits"][0].update(name="  "),
        lambda d: d["cells"][0].update(habit="Unknown"),
        lambda d: d["cells"].append(dict(d["cells"][0])),  # duplicate (day, habit)
        lambda d: d.update(contract_version=CONTRACT_VERSION + 1),
    ],
)
def test_invalid_rejected(mutate):
    import copy

    bad = copy.deepcopy(VALID)
    mutate(bad)
    with pytest.raises(ValidationError):
        Extraction.model_validate(bad)
