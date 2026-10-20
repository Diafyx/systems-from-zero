# Card Flow

An interactive explanation of how an online debit or credit card payment works. The site starts with a shopper and a store, then adds checkout, payment routing, authentication, authorization, money movement, reliable state, and after-payment handling.

## Open locally

Open `index.html` in a browser. The site uses plain HTML, CSS, and JavaScript, so there is no install or build step.

## Project files

- `index.html` — page content and source links
- `styles.css` — layout, responsive styles, and motion
- `app.js` — the eight interactive steps and approve/decline example
- `favicon.svg` — site icon

The diagrams are a teaching model of a typical online card payment. Providers and regions can use different routes or timing. The footer links to Visa and Stripe documentation for the core payment stages.

## Publishing

After you create the repository in your Git organization and push these files, a static host can serve `index.html` from the repository root. No environment variables or payment credentials are needed; this is an educational site, not a payment processor.
