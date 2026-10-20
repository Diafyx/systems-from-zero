const sources = {
  intent: ["Stripe: Payment Intents", "https://docs.stripe.com/payments/paymentintents/lifecycle"],
  api: ["Stripe: PaymentIntent API", "https://docs.stripe.com/api/payment_intents"],
  element: ["Stripe: Payment Element", "https://docs.stripe.com/payments/payment-element"],
  visa: ["Visa: authorization and capture", "https://developer.visa.com/docs/visanet-connect-acceptance"],
  auth: ["Stripe: 3-D Secure", "https://docs.stripe.com/payments/3d-secure"],
  capture: ["Stripe: separate authorization and capture", "https://docs.stripe.com/payments/place-a-hold-on-a-payment-method"],
  webhook: ["Stripe: webhook delivery", "https://docs.stripe.com/webhooks"],
  outbox: ["Debezium: outbox pattern", "https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html"],
  payout: ["Stripe: payouts", "https://docs.stripe.com/payouts"],
  balance: ["Stripe: balance transactions", "https://docs.stripe.com/api/balance_transactions"],
  refund: ["Stripe: refunds", "https://docs.stripe.com/refunds"],
  dispute: ["Stripe: disputes", "https://docs.stripe.com/disputes"]
};

const participants = [
  { name: "Shopper", detail: "Places the order", added: 0 },
  { name: "Store", detail: "Owns price and order", added: 0 },
  { name: "Secure checkout", detail: "Collects card data", added: 2 },
  { name: "Payment provider", detail: "Owns the payment object", added: 1 },
  { name: "Acquirer", detail: "Store-side route", added: 3 },
  { name: "Card network", detail: "Connects both sides", added: 3 },
  { name: "Issuer", detail: "Decides on the card", added: 3 }
];

const layers = [
  { name: "STORE STATE", items: [
    { at: 0, label: "Order" }, { at: 1, label: "Payment ID" },
    { at: 7, label: "Verified webhook" }, { at: 8, label: "Fulfillment" }
  ] },
  { name: "MONEY", items: [
    { at: 5, label: "Authorization" }, { at: 6, label: "Capture" },
    { at: 9, label: "Settlement" }, { at: 10, label: "Payout + reconcile" }
  ] },
  { name: "AFTERWARD", items: [
    { at: 11, label: "Refund" }, { at: 12, label: "Dispute" }
  ] }
];

const steps = [
  {
    name: "Price the order",
    title: "Create an order before asking for money.",
    lead: "The shopper buys a $42 item. The store server calculates the final price and creates order ord_1042. Nothing has reached a bank.",
    focus: ["Shopper", "Store"],
    signal: "Order created",
    from: "Shopper → Store API",
    to: "Store database",
    message: "Cart item and shipping choice → server-calculated amount 4200, currency usd.",
    state: "Order awaiting_payment; no provider payment yet.",
    why: "The amount must come from trusted server data, not a browser field a shopper can edit.",
    build: "Store API + PostgreSQL. Save order ID, amount in the smallest currency unit, currency, and state.",
    inside: "Treat ord_1042 and 4200 usd as a snapshot. If the cart changes, reprice before creating or confirming a payment. Keep payment attempts separate from the order.",
    failure: "If inventory or price validation fails, stop before creating a payment. Do not accept a client-supplied total.",
    rule: "One order has one trusted amount and currency at the moment payment begins.",
    source: "intent"
  },
  {
    name: "Create the payment",
    title: "Give the order a provider payment object.",
    lead: "The store asks Stripe to prepare a card payment for 4200 cents. It saves the returned PaymentIntent ID against the order.",
    focus: ["Store", "Payment provider"],
    signal: "PaymentIntent created",
    from: "Store API → Stripe",
    to: "PaymentIntent pi_example",
    message: "POST /v1/payment_intents: amount=4200, currency=usd, payment_method_types[]=card, capture_method=manual; one idempotency key.",
    state: "Order awaiting_payment; intent requires_payment_method.",
    why: "A durable provider ID lets the store find the same attempt after a reload, timeout, or webhook.",
    build: "Server-side provider SDK. Store order_id ↔ provider_intent_id. Pass only the client secret to this shopper's browser.",
    inside: "This guide uses Stripe's lower-level Payment Intents API so every state is visible. Stripe recommends Checkout Sessions for most production checkouts. Manual capture makes authorization and capture separate teaching steps.",
    failure: "If the API response is lost, retry the same operation with the same idempotency key or retrieve the known intent. Do not create an unrelated second charge.",
    rule: "A network timeout means unknown, not failed.",
    source: "api"
  },
  {
    name: "Collect the card",
    title: "Put card entry on the provider's side.",
    lead: "The browser shows a provider-controlled Payment Element. The store keeps a payment reference; it does not save the card number or security code.",
    focus: ["Shopper", "Secure checkout", "Payment provider"],
    signal: "Card data entered securely",
    from: "Shopper's browser → Stripe Element",
    to: "Stripe, when the form is confirmed",
    message: "Card details and the PaymentIntent client secret. Raw card data stays out of the store API.",
    state: "Order awaiting_payment; intent still needs confirmation.",
    why: "The provider handles sensitive card entry and the store can focus on the order.",
    build: "Stripe.js + Payment Element. Keep secret API keys on the server; do not log client secrets or raw card data.",
    inside: "The client secret lets this browser complete this specific payment. It is not a server API key. Provider-controlled fields reduce card-data exposure, but the checkout page still needs protection and PCI duties remain.",
    failure: "Invalid card input is corrected in the form before a payment can complete.",
    rule: "The store's order table never contains a PAN or CVC.",
    source: "element"
  },
  {
    name: "Reach the issuer",
    title: "Follow the authorization route.",
    lead: "On confirmation, the provider passes the request through the acquiring side and card network to the issuer behind the shopper's card.",
    focus: ["Payment provider", "Acquirer", "Card network", "Issuer"],
    signal: "Authorization request travels",
    from: "Provider → acquirer → network",
    to: "Issuer or its processor",
    message: "Browser calls stripe.confirmPayment with Elements and the client secret. The provider routes amount, currency, merchant context, and card credential or token; this is not a network wire format.",
    state: "Payment in progress; order remains unpaid.",
    why: "The store cannot decide whether the shopper's card has available funds or credit.",
    build: "The store calls the provider API. The provider's acquiring setup handles the downstream route.",
    inside: "The acquirer is on the merchant side; the issuer is on the cardholder side. Some providers combine roles, and network paths vary.",
    failure: "A provider risk rule or network problem can stop a request before the issuer makes a final approval decision.",
    rule: "Route ownership changes at the provider boundary.",
    source: "visa"
  },
  {
    name: "Check identity",
    title: "Authenticate the shopper when required.",
    lead: "Some card payments need 3-D Secure. The issuer may allow a frictionless check or ask the shopper to complete a challenge.",
    focus: ["Secure checkout", "Payment provider", "Issuer"],
    signal: "Optional 3-D Secure",
    from: "Provider → browser ↔ issuer",
    to: "Provider continues confirmation",
    message: "If required, intent requires_action; the shopper completes the issuer challenge.",
    state: "Order awaiting_payment; authorization is not final yet.",
    why: "Knowing the card details alone may not prove who is using the card.",
    build: "Let the provider SDK handle the required action and return. Keep the order pending while the shopper is away.",
    inside: "Authentication checks the shopper. Authorization checks whether this payment is approved. A challenge can fail or be abandoned.",
    failure: "If the shopper closes the page mid-challenge, do not mark the order paid. Recover from the provider state and later webhook.",
    rule: "A passed identity check is not an approved charge.",
    source: "auth"
  },
  {
    name: "Read the decision",
    title: "The issuer approves or declines.",
    lead: "The authorization result returns along the route. In this manual-capture example, approval places a hold and the PaymentIntent becomes requires_capture.",
    focus: ["Issuer", "Payment provider", "Store"],
    signal: "Approved: funds held",
    from: "Issuer → network → provider",
    to: "Store payment view",
    message: "Approved, declined, or still unknown to the store. Approved intent: requires_capture.",
    state: "Approved: order authorized, not paid. Declined: order still unpaid.",
    why: "The decision is about permission to charge, not funds arriving in the merchant bank.",
    build: "Persist the provider ID and status. Use the provider's current state to resolve ambiguous outcomes.",
    inside: "A declined card attempt can return the PaymentIntent to requires_payment_method so the shopper may try another method. The store can also apply its own fraud or inventory checks.",
    failure: "If the request times out, do not interpret silence as decline. Retrieve the intent or wait for a verified event before taking the next action.",
    rule: "Authorized is a separate state from paid.",
    source: "intent"
  },
  {
    name: "Capture the hold",
    title: "Submit the approved charge.",
    lead: "After checking the order can be fulfilled, the store captures the authorized $42. For this card example, a successful capture completes the PaymentIntent.",
    focus: ["Store", "Payment provider"],
    signal: "Capture requested",
    from: "Store API → Stripe",
    to: "PaymentIntent pi_example",
    message: "POST /v1/payment_intents/pi_example/capture; use an idempotency key for retries.",
    state: "Intent requires_capture → succeeded; order waits for trusted confirmation.",
    why: "Manual capture keeps the approval and final charge as distinct actions.",
    build: "Capture only a currently authorized intent and before its authorization expires. Automatic capture is a simpler alternative.",
    inside: "Capture can be for less than the authorized amount; the rest is generally released. Most card payments allow only one capture. Cancel an uncaptured intent to release the hold.",
    failure: "If capture times out, retrieve the same intent before retrying. Never issue a fresh capture request on a new payment just because the first response was lost.",
    rule: "Do not capture a decline or an expired authorization.",
    source: "capture"
  },
  {
    name: "Confirm in the store",
    title: "Turn the provider result into order state.",
    lead: "Stripe sends a server-to-server event. The store verifies it and marks ord_1042 paid once, even if the browser closed or the event is delivered twice.",
    focus: ["Payment provider", "Store"],
    signal: "Verified webhook received",
    from: "Stripe webhook → Store API",
    to: "PostgreSQL order and event records",
    message: "payment_intent.succeeded + provider ID. Verify raw-body signature, match order and amount, deduplicate event.",
    state: "Order awaiting_payment or authorized → paid; intent succeeded.",
    why: "The browser's success screen is not a durable source of truth.",
    build: "Webhook endpoint + PostgreSQL unique constraints. Commit the event ID and order transition together; respond 2xx after durable acceptance.",
    inside: "Events may repeat or arrive out of order. Fetch the current payment object when needed and make order transitions monotonic. A paid order must not be changed back to unpaid by an older event.",
    failure: "If delivery fails, Stripe retries. The handler must safely accept duplicates and must not fulfill twice.",
    rule: "One provider success creates one paid-order transition.",
    source: "webhook"
  },
  {
    name: "Fulfill once",
    title: "Let the paid order start work.",
    lead: "A paid order can now trigger shipping, a receipt, or access to a digital product. The store must make each action safe to retry.",
    focus: ["Store"],
    signal: "Fulfillment starts",
    from: "Paid order → outbox or local job",
    to: "Fulfillment worker",
    message: "order.paid { order_id: ord_1042, payment_id: pi_example }.",
    state: "Order paid → fulfillment pending → fulfilled.",
    why: "Payment success and delivery are different jobs with different failure modes.",
    build: "Start with a database-backed worker. Add an outbox and Kafka when several services need the event.",
    inside: "Write the paid transition and outbox row in one database transaction. A publisher can later move the event to Kafka. Consumers still deduplicate by event or order ID.",
    failure: "If email or shipping fails, retry that job without charging again. A duplicate event must not ship a second item.",
    rule: "Exactly one business outcome, even when messages are delivered more than once.",
    source: "outbox"
  },
  {
    name: "Move the funds",
    title: "Clearing and settlement happen after capture.",
    lead: "Capture starts the downstream exchange of transaction details. The banks settle later; the merchant's provider balance may first show pending funds.",
    focus: ["Payment provider", "Acquirer", "Card network", "Issuer"],
    signal: "Clearing → settlement",
    from: "Acquiring side → network",
    to: "Issuing side and provider balance",
    message: "Captured transaction is submitted for clearing; settlement follows the network and provider schedule.",
    state: "Order paid; provider balance may be pending.",
    why: "A completed checkout and movement of funds to the merchant are different moments.",
    build: "Store the provider charge and balance-transaction references when available.",
    inside: "Authorization holds funds. Capture submits the charge. Clearing exchanges records; settlement moves funds between institutions. Exact timing is provider- and region-dependent.",
    failure: "Late adjustments or reversals can change the eventual balance. Do not infer a bank deposit from the order's paid state.",
    rule: "Paid order, settled funds, and bank payout are three different facts.",
    source: "visa"
  },
  {
    name: "Reconcile the money",
    title: "Match payments, fees, and bank payouts.",
    lead: "The provider moves available balance to the merchant's bank on a payout schedule. The store matches its orders to provider transactions, fees, refunds, and payout records.",
    focus: ["Store", "Payment provider"],
    signal: "Payout checked",
    from: "Provider balance and payout reports",
    to: "Merchant finance records",
    message: "Order ID ↔ intent/charge ID ↔ balance transaction ↔ payout ID; compare gross, fees, and net.",
    state: "Order paid; payout pending or paid out; reconciliation matched or exception.",
    why: "A checkout success does not explain how much reached the bank after fees and later changes.",
    build: "A daily reconciliation job, exception queue, and provider reports or APIs.",
    inside: "Keep immutable identifiers and amounts in the smallest currency unit. Record a mismatch for review rather than silently changing the order amount to match a payout.",
    failure: "A payout can be delayed or fail. Investigate unmatched provider transactions and orders; do not charge the shopper again to fix accounting.",
    rule: "Every paid order should be traceable to a provider transaction and its payout path.",
    source: "payout"
  },
  {
    name: "Return a payment",
    title: "Refund a captured payment when needed.",
    lead: "The store can request a full or partial refund against the captured payment. It tracks the refund separately from the original order payment.",
    focus: ["Store", "Payment provider"],
    signal: "Refund requested",
    from: "Store API → provider",
    to: "Original payment method",
    message: "Refund for pi_example, amount up to the captured amount; save refund ID and later status.",
    state: "Paid order with refund pending, succeeded, or failed.",
    why: "Returning money is a new lifecycle; it does not erase the original charge.",
    build: "Refund API, unique refund request key, refund table, and refund webhooks.",
    inside: "Multiple partial refunds can exist, but their total cannot exceed the original charge. An uncaptured authorization is canceled instead of refunded. Card refunds go back to the original payment method.",
    failure: "A refund may fail later. Keep its own state and resolve the customer case instead of showing 'refunded' immediately.",
    rule: "Refund state is separate from order payment state.",
    source: "refund"
  },
  {
    name: "Handle a dispute",
    title: "A cardholder can challenge a charge.",
    lead: "A dispute starts with the cardholder's issuer, sometimes long after checkout. The store records the case and decides whether to accept it or submit evidence.",
    focus: ["Issuer", "Card network", "Payment provider", "Store"],
    signal: "Dispute case opened",
    from: "Issuer → network → provider",
    to: "Store support or risk team",
    message: "Dispute ID, reason, amount, deadline, and evidence request.",
    state: "Original order may remain fulfilled; dispute open, won, or lost.",
    why: "Payment success is not a permanent guarantee that the merchant keeps the funds.",
    build: "Dispute webhooks, evidence records, owner, deadline, and finance adjustment.",
    inside: "Link the dispute to the original charge and fulfillment proof. A chargeback can debit the provider balance while the case is open. Do not treat it as a simple refund.",
    failure: "Missing a response deadline can lose the case. Avoid issuing an unrelated refund without checking the dispute state.",
    rule: "Track disputes as separate cases tied to the original payment.",
    source: "dispute"
  }
];

const $ = id => document.getElementById(id);
const ui = {
  steps: $("steps"), number: $("step-number"), progress: $("progress-fill"),
  title: $("step-title"), lead: $("step-summary"), route: $("route"), signal: $("signal"), layers: $("layers"),
  from: $("handoff-from"), to: $("handoff-to"), message: $("handoff-message"),
  state: $("handoff-state"), why: $("step-why"), build: $("step-tech"),
  inside: $("step-inside"), failure: $("step-failure"), rule: $("takeaway"),
  source: $("step-source"), previous: $("previous"), next: $("next")
};
let current = 0;
ui.steps.innerHTML = steps.map((step, index) =>
  '<button type="button" role="tab" aria-controls="step-content" aria-selected="false" tabindex="-1" data-step="' + index + '"><span>' +
  String(index + 1).padStart(2, "0") + '</span>' + step.name + '</button>'
).join("");

function render() {
  const step = steps[current];
  const index = String(current + 1).padStart(2, "0");
  ui.number.textContent = "STEP " + index + " OF " + steps.length;
  ui.progress.style.width = ((current + 1) / steps.length * 100) + "%";
  ui.title.textContent = step.title;
  ui.lead.textContent = step.lead;
  ui.signal.textContent = step.signal;
  ui.from.textContent = step.from;
  ui.to.textContent = step.to;
  ui.message.textContent = step.message;
  ui.state.textContent = step.state;
  ui.why.textContent = step.why;
  ui.build.textContent = step.build;
  ui.inside.textContent = step.inside;
  ui.failure.textContent = step.failure;
  ui.rule.textContent = step.rule;
  ui.source.textContent = sources[step.source][0];
  ui.source.href = sources[step.source][1];
  ui.previous.disabled = current === 0;
  ui.next.textContent = current === steps.length - 1 ? "Start again ↺" : "Next step →";

  ui.steps.querySelectorAll("button").forEach((button, i) => {
    const active = i === current;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  const active = participants.filter(node => node.added <= current);
  ui.route.innerHTML = active.map((node, i) =>
    '<div class="route-node' + (step.focus.includes(node.name) ? ' is-focus' : '') +
    (node.added === current ? ' is-new' : '') + '"><span class="route-index">' +
    String(i + 1).padStart(2, "0") + '</span><strong>' + node.name + '</strong><small>' +
    node.detail + '</small></div>' +
    (i < active.length - 1 ? '<span class="route-arrow" aria-hidden="true">↓</span>' : '')
  ).join("");
  ui.layers.innerHTML = layers.map(layer => {
    const shown = layer.items.filter(item => item.at <= current);
    if (!shown.length) return "";
    return '<div class="layer"><span>' + layer.name + '</span><p>' +
      shown.map(item => '<strong' + (item.at === current ? ' class="is-new"' : '') + '>' +
        item.label + '</strong>').join('<i aria-hidden="true">→</i>') +
      '</p></div>';
  }).join("");
}
function selectStep(index, focus = false) {
  current = Math.max(0, Math.min(steps.length - 1, index));
  render();
  const button = ui.steps.querySelectorAll("button")[current];
  if (focus) button.focus();
  if (typeof window !== "undefined") {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (window.matchMedia("(max-width: 720px)").matches) {
      ui.steps.scrollTo({
        left: button.offsetLeft - ui.steps.offsetLeft - (ui.steps.clientWidth - button.offsetWidth) / 2,
        behavior: reduced ? "auto" : "smooth"
      });
    }
    ui.title.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }
}
ui.steps.addEventListener("click", event => {
  const button = event.target.closest("button[data-step]");
  if (button) selectStep(Number(button.dataset.step));
});
ui.steps.addEventListener("keydown", event => {
  const target = event.key === "ArrowRight" || event.key === "ArrowDown" ? current + 1 :
    event.key === "ArrowLeft" || event.key === "ArrowUp" ? current - 1 :
    event.key === "Home" ? 0 : event.key === "End" ? steps.length - 1 : null;
  if (target === null) return;
  event.preventDefault();
  selectStep(target, true);
});
ui.previous.addEventListener("click", () => selectStep(current - 1));
ui.next.addEventListener("click", () => selectStep(current === steps.length - 1 ? 0 : current + 1));
render();
