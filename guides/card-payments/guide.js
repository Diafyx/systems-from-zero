const steps = [
  {
    name: "Start with an order", title: "A shopper wants to pay.",
    summary: "The store has an order for $42. It knows who is buying and how much is due. No bank has been asked yet.",
    why: "Every payment starts with a clear order and amount.",
    tech: "A store page and a server that creates the order.",
    takeaway: "A Pay button starts the process. It does not move money by itself.",
    count: 2
  },
  {
    name: "Collect the card", title: "Add a secure checkout.",
    summary: "The shopper enters card details in a provider-controlled form. The store keeps an order and a payment reference.",
    why: "The store needs a safe way to collect card details and start a payment request.",
    tech: "A hosted form, such as Stripe Payment Element, and a payment provider API.",
    takeaway: "Card details go from secure checkout to the provider, not into the store's order record.",
    count: 4
  },
  {
    name: "Reach the bank", title: "Route the request to the issuer.",
    summary: "The provider uses an acquirer and card network to reach the issuer, the bank behind the shopper's card.",
    why: "Only the issuer, or a party acting for it, can approve or decline this card payment.",
    tech: "The store calls its provider API. The provider handles the route to the banks.",
    takeaway: "The acquirer is on the store's side. The issuer is on the shopper's side.",
    count: 7
  },
  {
    name: "Check identity", title: "Check the shopper when needed.",
    summary: "Some payments need 3-D Secure. The shopper may approve a prompt in a banking app before authorization finishes.",
    why: "Card details alone may not prove that the real cardholder is paying.",
    tech: "The provider's checkout or SDK shows the issuer's challenge when required.",
    takeaway: "Authentication checks the shopper. Authorization decides whether the payment is approved.",
    count: 7
  },
  {
    name: "Get the decision", title: "The issuer says yes or no.",
    summary: "The issuer checks the account and returns an approval or decline. An approval usually places a hold for the amount.",
    why: "The store needs the issuer's answer before it can continue with this payment.",
    tech: "The provider exposes the result; the store records the payment state.",
    takeaway: "Approval is permission to charge. Funds have not reached the store yet.",
    count: 7
  },
  {
    name: "Finish the charge", title: "Move from approval to payment.",
    summary: "An approved charge is captured. Clearing sends the transaction details between banks. Settlement moves funds later.",
    why: "Authorization and money movement are separate parts of the lifecycle.",
    tech: "Capture may be automatic or sent through the provider's capture API.",
    takeaway: "A declined attempt does not move on to capture or settlement.",
    count: 7
  },
  {
    name: "Keep state in sync", title: "Keep the order accurate.",
    summary: "The provider sends server-to-server updates. The store verifies them, handles repeats safely, and updates its order record.",
    why: "A shopper can close the page, and messages can arrive more than once.",
    tech: "A webhook handler, PostgreSQL, and idempotency keys. Kafka is optional for sharing later events with other store services.",
    takeaway: "The store uses server-side payment state before it fulfills an order.",
    count: 7
  },
  {
    name: "Handle later changes", title: "The story can continue.",
    summary: "A completed charge may be refunded. A cardholder may also dispute a charge through the issuer.",
    why: "The store needs records and updates after checkout too.",
    tech: "A provider refund API, dispute webhooks, and the store's support tools.",
    takeaway: "The full system covers the decision, money movement, and changes afterward.",
    count: 7
  }
];

const route = [
  { name: "Shopper", detail: "Starts the purchase", added: 0 },
  { name: "Store", detail: "Creates the order", added: 0 },
  { name: "Secure checkout", detail: "Collects card details", added: 1 },
  { name: "Payment provider", detail: "Sends the request", added: 1 },
  { name: "Acquirer", detail: "Store-side bank partner", added: 2 },
  { name: "Card network", detail: "Routes between banks", added: 2 },
  { name: "Issuer", detail: "Cardholder's bank", added: 2 }
];

const features = [
  { at: 3, text: "3-D Secure if needed" },
  { at: 4, text: "Authorization response" },
  { at: 5, text: "Capture → clearing → settlement" },
  { at: 6, text: "Webhooks + safe retries" },
  { at: 7, text: "Refunds + disputes" }
];

const $ = id => document.getElementById(id);
const ui = {
  steps: $("steps"), number: $("step-number"), progress: $("progress-fill"),
  title: $("step-title"), summary: $("step-summary"), why: $("step-why"),
  tech: $("step-tech"), takeaway: $("takeaway"), route: $("route"),
  features: $("features"), outcome: $("outcome"), outcomeText: $("outcome-text"),
  previous: $("previous"), next: $("next")
};

let current = 0;
let decision = "approved";

ui.steps.innerHTML = steps.map((step, index) => `<button type="button" role="tab" aria-controls="step-content" aria-selected="false" tabindex="-1" data-step="${index}"><span>${String(index + 1).padStart(2, "0")}</span>${step.name}</button>`).join("");

function render() {
  const step = steps[current];
  const declined = decision === "declined" && current >= 4;
  ui.number.textContent = `STEP ${String(current + 1).padStart(2, "0")} OF 08`;
  ui.progress.style.width = `${(current + 1) * 12.5}%`;
  ui.title.textContent = declined && current === 5 ? "A decline ends this attempt."
    : declined && current === 6 ? "Record the decline."
    : declined && current === 7 ? "The shopper can try again."
    : step.title;
  ui.summary.textContent = declined && current === 5
    ? "The issuer declined this payment. There is no approval to capture, so clearing and settlement do not happen for this attempt."
    : declined && current === 6
    ? "The provider sends the result to the store. The store records the failed attempt and keeps the order unpaid."
    : declined && current === 7
    ? "The store can offer another payment method. A later successful attempt starts a separate payment lifecycle."
    : step.summary;
  ui.why.textContent = declined && current >= 5
    ? "A clear payment state prevents the store from treating a failed attempt as paid."
    : step.why;
  ui.tech.textContent = declined && current >= 5
    ? "The provider result, a verified webhook, and the store's order record."
    : step.tech;
  ui.takeaway.textContent = declined && current >= 5
    ? "This attempt was declined. There is no capture or settlement; the store can ask for another payment method."
    : step.takeaway;
  ui.previous.disabled = current === 0;
  ui.next.textContent = current === steps.length - 1 ? "Start again ↺" : "Next step →";

  ui.steps.querySelectorAll("button").forEach((button, index) => {
    const selected = index === current;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });

  ui.route.innerHTML = route.slice(0, step.count).map((node, index) => `
    <div class="route-node${node.added === current ? " is-new" : ""}">
      <span class="route-index">${String(index + 1).padStart(2, "0")}</span>
      <strong>${node.name}</strong><small>${node.detail}</small>
    </div>${index < step.count - 1 ? '<span class="route-arrow" aria-hidden="true">↓</span>' : ""}
  `).join("");

  ui.features.innerHTML = features.filter(item => item.at <= current).map(item =>
    `<span class="feature${declined && (item.at === 5 || item.at === 7) ? " is-blocked" : ""}">${item.text}</span>`
  ).join("");
  ui.features.hidden = current < 3;
  ui.outcome.hidden = current < 4;
  ui.outcomeText.textContent = declined ? "Declined: this payment attempt stops." : "Approved: the decision travels back to the store.";
  ui.outcome.classList.toggle("is-declined", declined);
  ui.outcome.querySelectorAll("button").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.decision === decision));
  });
}

function selectStep(index, focus = false) {
  current = Math.max(0, Math.min(steps.length - 1, index));
  render();
  if (focus) ui.steps.querySelectorAll("button")[current].focus();
}

ui.steps.addEventListener("click", event => {
  const button = event.target.closest("button[data-step]");
  if (button) selectStep(Number(button.dataset.step));
});
ui.steps.addEventListener("keydown", event => {
  const target = event.key === "ArrowRight" || event.key === "ArrowDown" ? current + 1
    : event.key === "ArrowLeft" || event.key === "ArrowUp" ? current - 1
    : event.key === "Home" ? 0 : event.key === "End" ? steps.length - 1 : null;
  if (target === null) return;
  event.preventDefault();
  selectStep(target, true);
});
ui.outcome.addEventListener("click", event => {
  const button = event.target.closest("button[data-decision]");
  if (!button) return;
  decision = button.dataset.decision;
  render();
});
ui.previous.addEventListener("click", () => selectStep(current - 1));
ui.next.addEventListener("click", () => selectStep(current === steps.length - 1 ? 0 : current + 1));
render();
