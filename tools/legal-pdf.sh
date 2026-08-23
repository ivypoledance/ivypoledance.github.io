#!/usr/bin/env bash
#
# Renders a legal document from its markdown source to PDF.
#
#   tools/legal-pdf.sh content/agb.md public/download/AGB-IvyPoledance.pdf
#
# The markdown is the single source of truth: Zola publishes it as a page and
# this typesets the same file, so the page and the PDF cannot drift apart.
#
# pandoc reads the markdown directly and typst does the typesetting. Both live
# in one multi-architecture image, so the output is the same locally and in CI,
# and neither step involves a browser.
set -euo pipefail

SRC="${1:?usage: legal-pdf.sh <source.md> <output.pdf>}"
OUT="${2:?usage: legal-pdf.sh <source.md> <output.pdf>}"

PANDOC_IMAGE="pandoc/typst:latest"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Zola's front matter is TOML between +++ fences. pandoc would typeset it as
# text, so it is stripped and the fields needed here are read out first.
field() { sed -n "s/^$1 *= *\"\(.*\)\"/\1/p" "$SRC" | head -1; }
TITLE="$(field title)"
FASSUNG="$(field fassung)"
: "${TITLE:?$SRC has no title in its front matter}"

# Kept inside the repository rather than the system temp directory, which is
# not shared with the container runtime on macOS.
#
# A fresh directory per run, never a fixed one that is deleted and recreated:
# the container runtime caches the bind mount source, so reusing the path makes
# back-to-back runs mount a stale directory that no longer exists inside the
# container.
WORK="$(mktemp -d "$ROOT/.legal-pdf-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

awk 'BEGIN { fences = 0 }
     /^\+\+\+[[:space:]]*$/ { fences++; next }
     fences >= 2 { print }' "$SRC" > "$WORK/body.md"

if [ ! -s "$WORK/body.md" ]; then
  echo "::error::$SRC produced an empty body; is the front matter fenced with +++?" >&2
  exit 1
fi

# German quotation marks are handed over as plain quotes and set by typst's
# German smart-quote rules. Passing the characters through instead loses the
# distinction: pandoc rewrites the closing U+201C as a plain quote, which typst
# then sets as another opening mark, so both ends come out low.
#
# Matched as raw bytes under LC_ALL=C, which behaves the same in the BSD and
# GNU sed this runs against.
LC_ALL=C sed -i.bak \
  -e "s/$(printf '\342\200\236')/\"/g" \
  -e "s/$(printf '\342\200\234')/\"/g" \
  "$WORK/body.md"
rm -f "$WORK/body.md.bak"

# The footer states which version the reader is holding: these documents change
# over time and customers agree to a particular one, so a printed copy has to
# identify itself.
FOOTER_LEFT="Ivy Poledance"
[ -n "$FASSUNG" ] && FOOTER_LEFT="Ivy Poledance · Fassung $FASSUNG"

cat > "$WORK/header.typ" <<TYPST
#set page(
  paper: "a4",
  margin: 2.5cm,
  footer: context [
    #set text(size: 8pt)
    ${FOOTER_LEFT}
    #h(1fr)
    Seite #counter(page).display() von #counter(page).final().first()
  ],
)
#set text(lang: "de", region: "at", size: 11pt, hyphenate: true)
#set par(leading: 0.7em, spacing: 1.1em)
// Clause numbers carry the structure, so headings stay restrained.
#show heading.where(level: 1): set text(size: 13pt)
#show heading.where(level: 2): set text(size: 11pt, style: "italic")
TYPST

mkdir -p "$(dirname "$OUT")"

# fancy_lists is disabled so the "a." to "g." paragraphs in the liability clause
# stay exactly as written instead of being renumbered as a list.
docker run --rm -v "$WORK:/work" -w /work \
  --entrypoint pandoc "$PANDOC_IMAGE" \
    body.md \
    --from=markdown-fancy_lists \
    --output=out.pdf \
    --pdf-engine=typst \
    --include-in-header=header.typ \
    --metadata title="$TITLE" \
    --metadata lang=de-AT \
    --variable papersize=a4 \
    --variable margin.x=2.5cm \
    --variable margin.y=2.5cm

cp "$WORK/out.pdf" "$OUT"
echo "wrote $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
