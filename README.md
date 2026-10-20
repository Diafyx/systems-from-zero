# Systems from Zero

A growing library of visual guides to how complex systems work. Each guide starts with the smallest useful version and adds components one at a time. The first guide covers online debit and credit card payments.

## Open locally

Open `index.html` in a browser. The site uses plain HTML, CSS, and JavaScript, so there is no install or build step.

## Project files

- `index.html` and `home.css` — collection homepage
- `guides/card-payments/index.html` — first guide
- `styles.css` and `app.js` — card guide styles and eight interactive steps
- `favicon.svg` — shared site icon

The card guide's diagrams are a teaching model of a typical online card payment. Its payment path shows who handles the request; its implementation section shows one possible store-side stack with a hosted checkout, PostgreSQL, webhooks, and optional Kafka. Kafka carries events to other store services in this example; the issuer still decides whether to approve a card payment. Providers and regions can use different routes or timing. The guide footer links to primary documentation for the payment stages and example tools.

## Adding a guide

Give each new topic its own folder under `guides/` with an `index.html`, then add a link to it in the homepage's guide section. Keep the root page about the collection rather than one topic.

## Publishing

Cloudflare Pages can serve the repository root directly. Use no framework, production branch `main`, build command `exit 0`, build output directory `.`, and leave the root directory unset. No environment variables or payment credentials are needed; this is an educational site, not a payment processor.
