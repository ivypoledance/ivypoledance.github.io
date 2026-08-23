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

# Pinned, not :latest. These documents get re-rendered years apart and the
# output must not re-flow because an upstream tag moved. The tag fixes pandoc
# (3.10); typst's version is not part of any pandoc/typst tag, so pin the digest
# instead if that matters more than readability.
PANDOC_IMAGE="pandoc/typst:3.10.0.0"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Zola's front matter is TOML between +++ fences. pandoc would typeset it as
# text, so it is stripped and the fields needed here are read out first.
field() { sed -n "s/^$1 *= *\"\(.*\)\"/\1/p" "$SRC" | head -1; }
TITLE="$(field title)"
FASSUNG="$(field fassung)"
: "${TITLE:?$SRC has no title in its front matter}"
: "${FASSUNG:?$SRC has no fassung in its front matter}"

# The PDF records the document's own Fassung date as its creation date rather
# than the moment of the build, which typst takes from SOURCE_DATE_EPOCH. Two
# runs of one source then produce identical bytes on any machine, so a PDF that
# differs means the markdown behind it changed.
if [[ ! "$FASSUNG" =~ ^([0-9]{2})\.([0-9]{2})\.([0-9]{4})$ ]]; then
  echo "::error::$SRC has fassung \"$FASSUNG\", expected DD.MM.YYYY" >&2
  exit 1
fi
ISO_FASSUNG="${BASH_REMATCH[3]}-${BASH_REMATCH[2]}-${BASH_REMATCH[1]}"
# GNU date first, then the BSD form used on macOS.
SOURCE_DATE_EPOCH="$(
  date -u -d "$ISO_FASSUNG" +%s 2>/dev/null ||
  date -u -j -f '%Y-%m-%d' "$ISO_FASSUNG" +%s
)"
export SOURCE_DATE_EPOCH

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

# Images are written for the web, as a path from the site root that Zola serves
# out of static/. typst resolves a path against the working directory and, told
# nothing else, scales an image to the full text width, so each file is copied
# next to the markdown and asked for at the size its own width attribute states.
# CSS pixels are 1/96 inch and typst points 1/72, hence the factor.
for path in $(grep -o '](/[^)]*\.svg)' "$WORK/body.md" | sed 's/^](//; s/)$//' | sort -u); do
  asset="$ROOT/static$path"
  if [ ! -f "$asset" ]; then
    echo "::error::$SRC references $path, which is not in static/" >&2
    exit 1
  fi
  width_px="$(sed -n 's/.*<svg[^>]* width="\([0-9.]*\)".*/\1/p' "$asset" | head -1)"
  if [ -z "$width_px" ]; then
    echo "::error::$asset has no width attribute, so it cannot be sized for print" >&2
    exit 1
  fi
  # The roughening filter on the contact artwork is dropped for print. typst
  # rasterises SVG filters through resvg, whose feTurbulence and
  # feDisplacementMap do not agree with a browser's, and the lettering comes out
  # as noise at any size. The outlines underneath print sharply and are still
  # not text, which is the point of the artwork.
  sed 's/ filter="url([^)]*)"//g' "$asset" > "$WORK/$(basename "$path")"
  width_pt="$(awk -v px="$width_px" 'BEGIN { printf "%.1f", px * 0.75 }')"
  sed -i.bak "s|](${path})|]($(basename "$path")){width=${width_pt}pt}|g" "$WORK/body.md"
  rm -f "$WORK/body.md.bak"
done

# The footer states which version the reader is holding: these documents change
# over time and customers agree to a particular one, so a printed copy has to
# identify itself.
FOOTER_LEFT="Ivy Poledance · Fassung $FASSUNG"

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
// Clause numbers carry the structure, so headings stay restrained. The clause
// headings the documents start from land on level 2; their sub-headings are
// level 3 and are set in italic rather than bold, so they read as a subdivision
// of the clause above them and not as another clause.
#show heading.where(level: 1): set text(size: 13pt)
#show heading.where(level: 2): set text(size: 11pt, style: "italic")
#show heading.where(level: 3): set text(size: 11pt, style: "italic", weight: "regular")
TYPST

mkdir -p "$(dirname "$OUT")"

# fancy_lists is disabled so the "a." to "g." paragraphs in the liability clause
# stay exactly as written instead of being renumbered as a list. implicit_figures
# is disabled so an image on its own line stays in the text instead of becoming a
# numbered figure with a caption. Bare addresses are deliberately not autolinked:
# Zola does not autolink them either, and a link the PDF has but the page does not
# is a difference between two renderings of one source.
docker run --rm -v "$WORK:/work" -w /work \
  -e SOURCE_DATE_EPOCH \
  --entrypoint pandoc "$PANDOC_IMAGE" \
    body.md \
    --from=markdown-fancy_lists-implicit_figures \
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
