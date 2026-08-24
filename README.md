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
`Sync course dates` validates `coursedates.csv` on every change and only sends it
to the booking API when run by hand.

Required secrets and API token scopes are documented at the top of
`.github/workflows/pr-preview.yaml`.

## ToDo

Most worth doing first.

1. [ ] **The booking page is published and broken.** `/courses/courses-and-booking/book/`
   answers 200 while the `js/book.js` it asks for answers 404, so the form does
   nothing at all. Finish it or take the page down — it is the only entry here a
   visitor can already reach.
2. [ ] **Photos are shipped at their original size.** `static/img` is 191 MB and
   every byte of it is deployed: `polecamp/camp2025seefaded2.png` alone is 23 MB,
   and the poses drawn behind the course text at 30% opacity are up to 4.4 MB
   each. Only the galleries go through `resize_image`.
3. [ ] **Finish the booking flow.** The API in `booking/` is written and tested,
   but nothing reaches it and the site still books by `mailto:`. Left to do: the
   form, a mail provider with DKIM and SPF for `ivypoledance.at`, and deploying
   the Worker. `booking/README.md` has the steps.
4. [ ] Drop `submodules: recursive` and `lfs: true` from the checkouts in
   `build-and-publish.yaml` and `pr-preview.yaml`. This repository has neither.
5. [ ] Give the imprint its own icon in `config.toml`. It borrows feather's
   envelope, which reads as "write to us".
6. [ ] Favicon on a transparent background. None of the icons in `static/`
   carries an alpha channel.
7. [ ] Hold the decorative background images still while the page scrolls, and
   frame photographs the way the landing page does. Both mean lifting the inline
   styles repeated across the course pages into a class.
8. [ ] Remove the theme's unused math macro. It pins KaTeX 0.11.1 from a CDN and
   never renders, `config.extra.math` being unset.
9. [ ] Replace the vendored AdiDoks theme with a maintained Zola 0.23 / Tera v2
   theme, which would make item 8 moot.
10. [ ] Decide whether to restrict the `*.pages.dev` preview URLs (Pages →
    Settings → General → access policy); the domain itself cannot be removed.
