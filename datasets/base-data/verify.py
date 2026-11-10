"""Verify reproducible output and checked-in dispositions against the locked input."""
from pathlib import Path
import sys
import tempfile
import zipfile
from audit import build, ROOT


def verify(archive):
    with tempfile.TemporaryDirectory() as folder:
        first, second = Path(folder) / "first.zip", Path(folder) / "second.zip"
        first_sha = build(archive, first)
        if build(archive, second) != first_sha or first.read_bytes() != second.read_bytes():
            raise ValueError("Audit output is not byte reproducible")
        with zipfile.ZipFile(first) as z:
            for name in ["review/ingredients.json", "review/kitchenware.json", "review/recipes.json", "report.json"]:
                if (ROOT / name).read_bytes() != z.read(name):
                    raise ValueError("Checked-in evidence differs from source: " + name)
        print(first_sha)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: verify.py LOCKED_RC7.zip")
    verify(sys.argv[1])
