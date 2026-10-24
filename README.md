# Systems from Zero

A collection of guides that build complex systems one part at a time. Each guide follows one concrete example through the flow, the records or browser state, and the failure paths.

## Open locally

Open `index.html` in a browser. The site uses plain HTML, CSS, and JavaScript; there is no install or build step.

## Project files

- `index.html` and `home.css` — collection homepage
- `guides/shared.css` — shared guide layout
- `guides/card-payments/index.html` and `guide.js` — card payment guide
- `guides/website-load/index.html` and `guide.js` — website loading guide
- `guides/chat-delivery/index.html`, `guide-data.js`, and `guide.js` — chat delivery guide
- `favicon.svg` — shared icon

The card guide uses a Stripe PaymentIntent with manual capture so authorization and capture can be inspected separately. Each guide includes a full system map, implementation notes, failure checks, and links to primary sources. The examples are teaching designs, not descriptions of any company's private implementation. Stripe recommends Checkout Sessions for most production checkouts.

## Adding a guide

Give each topic its own folder under `guides/` with an `index.html`, then add a link on the homepage.

## Publishing

Cloudflare Pages can serve the repository root directly. Use no framework, production branch `main`, build command `exit 0`, build output directory `.`, and leave the root directory unset.
