#!/usr/bin/env python3
"""Package only the reviewed portable skill resources, never environment/output files."""
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/skills/folio-news"
DESTINATION = ROOT / "docs/qa/skills/folio-news.zip"
FILES = ["SKILL.md", "README.md", "references/api.md", "references/workflows.md",
         "scripts/folio.py", "scripts/test_folio.py", "evals/evals.json"]


def main():
    for name in FILES:
        path = SOURCE / name
        if path.is_symlink() or not path.is_file():
            raise RuntimeError("Missing or unsafe skill resource")
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(DESTINATION, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name in FILES:
            archive.write(SOURCE / name, "folio-news/" + name)
    with zipfile.ZipFile(DESTINATION) as archive:
        assert archive.testzip() is None
        assert set(archive.namelist()) == {"folio-news/" + name for name in FILES}
    print(DESTINATION.relative_to(ROOT))


if __name__ == "__main__":
    main()
