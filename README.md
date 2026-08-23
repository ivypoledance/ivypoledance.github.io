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

Both are built by CI with the Zola version pinned in the workflow, so staging and
production always come from the same toolchain. Previews are uploaded to
Cloudflare Pages; `Sweep stale previews` runs weekly, and can be run by hand, to
remove previews whose pull request is no longer open.

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
- [ ] Fill in the controller's postal address in `content/datenschutz.md` (currently a placeholder)
- [ ] Have a lawyer review the AGB and the Datenschutzerklärung before relying on them
- [ ] AGB defects to raise with the lawyer: clause 1 is missing, clause 11 contains items numbered 13.1/13.2, and 7.3(f) cites a non-existent "Punkt 5.11"
- [ ] Replace the Facebook embeds on the testimonials page with screenshots; they are the only content loaded from a third party, and dropping them removes the site's last transfer of visitor data
- [ ] Replace the vendored AdiDoks theme with a maintained Zola 0.23 / Tera v2 theme
- [ ] Booking page requests a missing `js/book.js` (404) — implement the form or unpublish the page
- [ ] Remove the theme's unused math macro (pins KaTeX 0.11.1; math is disabled)
- [ ] Recheck the `.form-floating` override in the theme sass on the next Bootstrap upgrade (it mirrors Bootstrap's own selectors)
- [ ] Drop `submodules: recursive` and `lfs: true` from the workflows (no submodules, no LFS in this repo)
- [ ] Decide whether to restrict the `*.pages.dev` preview URLs (Pages → Settings → General → access policy); the domain itself cannot be removed
