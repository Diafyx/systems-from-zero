# Systems from Zero

A collection of guides that build complex systems one part at a time. The first guide follows an online card payment from shopper to issuer, then shows how a store might implement its side.

## Open locally

Open `index.html` in a browser. The site uses plain HTML, CSS, and JavaScript; there is no install or build step.

## Project files

- `index.html` and `home.css` — collection homepage
- `guides/card-payments/index.html`, `guide.css`, and `guide.js` — interactive card guide
- `favicon.svg` — shared icon

The guide uses a simplified payment route for teaching. The software example includes a provider-controlled checkout form, PostgreSQL, webhooks, and optional Kafka for later store events. The issuer makes the approval decision. See the guide's Sources and scope section for documentation and limits.

## Adding a guide

Give each topic its own folder under `guides/` with an `index.html`, then add a link on the homepage.

## Publishing

Cloudflare Pages can serve the repository root directly. Use no framework, production branch `main`, build command `exit 0`, build output directory `.`, and leave the root directory unset.
