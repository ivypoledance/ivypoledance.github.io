# Ivy Poledance

Static site built with [Zola](https://www.getzola.org/) and a vendored copy of the
[AdiDoks](https://github.com/aaranxu/adidoks) theme.

## Deployment

- **Production** — pushing to `main` builds and publishes to GitHub Pages at
  <https://ivypoledance.at>, recorded under the `Production` environment.
- **Staging** — every pull request is published to its own subdomain,
  `https://pr-<number>.staging.ivypoledance.at`, recorded under the `Staging`
  environment and linked from a comment on the pull request. It is removed when
  the pull request closes.

Both run the same steps, out of the composite actions in `.github/actions/`, and
the generator version is pinned there once, so staging and production always come
from the same toolchain. Previews are uploaded to Cloudflare Pages; `Sweep stale
previews` runs weekly, and can be run by hand, to remove previews whose pull
request is no longer open.

The `Legal documents` workflow renders the AGB and the Datenschutzerklärung on
demand and attaches them to the run, for when the PDFs are wanted on their own.

Required secrets and API token scopes are documented at the top of
`.github/workflows/pr-preview.yaml`.

## ToDo:

- [ ] Favicon (transparent background)
- [ ] Automated booking
- [ ] Email send from booking
- [ ] Fixed position background images
- [ ] Optimize photos
- [ ] Photo frame (like on landing page)
- [ ] Different icon for imprint (feather or impressum in bottom bar)
- [ ] Have a lawyer review the AGB and the Datenschutzerklärung before relying on them
- [ ] Replace the vendored AdiDoks theme with a maintained Zola 0.23 / Tera v2 theme
- [ ] Booking page requests a missing `js/book.js` (404) — implement the form or unpublish the page
- [ ] Remove the theme's unused math macro (pins KaTeX 0.11.1; math is disabled)
- [ ] Recheck the `.form-floating` override in the theme sass on the next Bootstrap upgrade (it mirrors Bootstrap's own selectors)
- [ ] Drop `submodules: recursive` and `lfs: true` from the workflows (no submodules, no LFS in this repo)
- [ ] Decide whether to restrict the `*.pages.dev` preview URLs (Pages → Settings → General → access policy); the domain itself cannot be removed
