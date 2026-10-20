# Systems from Zero

A collection of guides that build complex systems one part at a time. The card payments guide follows one $42 online order through 13 concrete steps. Each step shows the handoff, payment state, store software, and what can fail.

## Open locally

Open `index.html` in a browser. The site uses plain HTML, CSS, and JavaScript; there is no install or build step.

## Project files

- `index.html` and `home.css` — collection homepage
- `guides/card-payments/index.html`, `guide.css`, and `guide.js` — interactive card guide
- `favicon.svg` — shared icon

The guide uses a Stripe PaymentIntent with manual capture so authorization and capture can be inspected separately. It also includes a full system map, implementation blueprint, failure checks, and links to primary sources. This is an educational worked example, not a universal bank message specification. Stripe recommends Checkout Sessions for most production checkouts.

## Adding a guide

Give each topic its own folder under `guides/` with an `index.html`, then add a link on the homepage.

## Publishing

Cloudflare Pages can serve the repository root directly. Use no framework, production branch `main`, build command `exit 0`, build output directory `.`, and leave the root directory unset.
