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

1. [ ] **Photos are shipped at their original size.** `static/img` is 191 MB and
   every byte of it is deployed: `polecamp/camp2025seefaded2.png` alone is 23 MB,
   and the poses drawn behind the course text at 30% opacity are up to 4.4 MB
   each. Only the galleries go through `resize_image`.
2. [ ] **Build the booking form.** The API in `booking/` is written and tested,
   but nothing reaches it: booking is by `mailto:` and there is no form. Left to
   do: the form, a mail provider with DKIM and SPF for `ivypoledance.at`, and
   deploying the Worker. `booking/README.md` has the steps, and the
   Datenschutzerklärung wants the D1 database and the mail provider named in it
   before any of this is public.
3. [ ] Frame photographs the way the landing page does: the landing image is
   still sized by an inline `style` in `templates/index.html`, and nothing else
   frames a picture that way.
4. [ ] Replace the vendored AdiDoks theme with a maintained Zola 0.23 / Tera v2
   theme.
