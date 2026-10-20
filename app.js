const steps = [
  {
    nav: "The sketch", tag: "THE FIRST SKETCH", title: "A customer wants to pay.",
    description: "A shopper is buying something for $42. The store knows the order and the amount. That is enough to draw the first two boxes, but no bank has been asked yet.",
    add: "The shopper, the store, and a $42 order.",
    why: "We need a clear starting point: who is paying, who is selling, and how much is due.",
    tech: "A store page and a server that creates an order. No payment service is connected yet.",
    takeaway: "A checkout button starts a request. It does not move money by itself.",
    status: "A first sketch"
  },
  {
    nav: "Safe checkout", tag: "COLLECT THE CARD", title: "Collect card details safely.",
    description: "The store adds a secure checkout and connects to a payment provider. The checkout can send card details to the provider, while the store works with a payment reference.",
    add: "A secure checkout and a payment provider.",
    why: "The store needs a safe way to collect payment details and a service that can start the payment request.",
    tech: "A provider-controlled form, such as Stripe Payment Element, and its browser SDK.",
    takeaway: "A payment reference lets the store track this attempt without putting raw card details in its own order record.",
    status: "Card details collected"
  },
  {
    nav: "Bank route", tag: "REACH THE ISSUER", title: "Find the card’s bank.",
    description: "The provider passes the request through an acquiring partner and the card network. The network routes it to the issuer: the bank behind the shopper’s card.",
    add: "The acquirer, card network, and issuer.",
    why: "The store cannot decide whether this card can pay. The request must reach the bank that issued it.",
    tech: "The store calls its payment provider API. The provider handles the route to the banks.",
    takeaway: "The acquirer is on the store’s side. The issuer is on the shopper’s side.",
    status: "Request reaches the issuer"
  },
  {
    nav: "Identity check", tag: "WHEN EXTRA PROOF IS NEEDED", title: "Check who is paying.",
    description: "Some online payments need an extra identity check, often called 3-D Secure. The shopper may approve in a banking app or complete another issuer challenge before authorization finishes.",
    add: "A conditional 3-D Secure check.",
    why: "Card details alone may not prove that the real cardholder is making the purchase. The extra check is used when required or requested.",
    tech: "The provider checkout or SDK shows the issuer’s challenge when one is required.",
    takeaway: "Authentication asks ‘Is this the shopper?’ Authorization asks ‘Will the issuer approve this payment?’",
    status: "Identity can be checked"
  },
  {
    nav: "Decision", tag: "AUTHORIZATION", title: "Ask for a decision.",
    description: "The issuer checks the account, available funds or credit, and other signals. It sends back an approval or a decline along the same route.",
    add: "An authorization response from the issuer.",
    why: "The store needs a firm answer before it treats the order as payable. An approval usually places a hold; it is not the final transfer of funds.",
    tech: "The provider API exposes the result; the store records the payment state for its order.",
    takeaway: "Try the Approved and Declined buttons in the diagram. A decline stops this payment attempt.",
    status: "Issuer has answered"
  },
  {
    nav: "Money moves", tag: "CAPTURE TO SETTLEMENT", title: "Turn approval into a charge.",
    description: "For an approved payment, the charge is captured, sometimes automatically. The transaction is then cleared between the banks, and settlement moves funds. This happens after the fast yes-or-no answer.",
    add: "Capture, clearing, and settlement.",
    why: "An authorization alone is a promise to pay. The later steps finalize the charge and move money between banks.",
    tech: "A provider capture API can finalize an authorization; some integrations capture automatically.",
    takeaway: "Approved now and paid out later are different states. A decline has no capture or settlement in this attempt.",
    status: "Charge can be completed"
  },
  {
    nav: "Reliable state", tag: "KEEP THE STORE IN SYNC", title: "Make the result reliable.",
    description: "The store saves a payment record, listens for server-to-server updates called webhooks, and uses a unique request key when retrying. The order changes state once, even if a browser closes or a request repeats.",
    add: "A payment record, webhooks, and safe retries.",
    why: "The shopper’s browser is not a reliable source of truth. The store needs to handle delayed updates and repeated messages safely.",
    tech: "PostgreSQL can store order state. A webhook handler verifies updates. Kafka is optional for sending confirmed events to other store services.",
    takeaway: "The store should confirm payment from its server-side state before it fulfills the order.",
    status: "Order state stays in sync"
  },
  {
    nav: "After payment", tag: "THE FULL LIFECYCLE", title: "Handle what happens later.",
    description: "A completed charge may later be refunded. A cardholder can also dispute a charge through the issuer. Those paths need records and clear order updates too.",
    add: "Refund and dispute handling.",
    why: "A payment system must still explain and manage the transaction after checkout is over.",
    tech: "The provider’s refund API and dispute webhooks can feed the store’s order and support tools.",
    takeaway: "The full flow covers the first decision, the movement of funds, and changes that happen afterward.",
    status: "Full payment lifecycle"
  }
];

const nodes = [
  { name: "Shopper", sub: "Has the card", icon: "◉", label: "PERSON", from: 0 },
  { name: "Store", sub: "Creates the order", icon: "⌂", label: "MERCHANT", from: 0 },
  { name: "Checkout", sub: "Collects details", icon: "▣", label: "SECURE UI", from: 1 },
  { name: "Payment provider", sub: "Starts the request", icon: "↗", label: "SERVICE", from: 1 },
  { name: "Acquirer", sub: "Store’s side", icon: "▥", label: "PARTNER", from: 2 },
  { name: "Card network", sub: "Routes the message", icon: "◇", label: "NETWORK", from: 2 },
  { name: "Issuer", sub: "Card’s bank", icon: "▤", label: "BANK", from: 2 }
];

const additions = [
  { label: "IDENTITY", name: "3-D Secure, if needed", from: 3 },
  { label: "MONEY", name: "Capture → clearing → settlement", from: 5 },
  { label: "RELIABILITY", name: "Webhooks + safe retries", from: 6 },
  { label: "AFTERWARD", name: "Refunds + disputes", from: 7 }
];

const refs = {
  nav: document.getElementById("step-nav"), count: document.getElementById("step-count"), progress: document.getElementById("step-progress-fill"),
  number: document.getElementById("step-number"), tag: document.getElementById("step-tag"), title: document.getElementById("step-title"),
  description: document.getElementById("step-description"), add: document.getElementById("step-add"), why: document.getElementById("step-why"), tech: document.getElementById("step-tech"),
  takeaway: document.getElementById("step-takeaway"), previous: document.getElementById("previous-step"), next: document.getElementById("next-step"),
  nodes: document.getElementById("flow-nodes"), extras: document.getElementById("diagram-extra"), response: document.getElementById("response-line"),
  responseLabel: document.getElementById("response-label"), status: document.getElementById("diagram-status"), scenarios: document.getElementById("scenario-controls")
};

let currentStep = 0;
let outcome = "approved";

function buildStaticUI() {
  refs.nav.innerHTML = steps.map((step, index) => `<button class="step-tab" role="tab" id="step-tab-${index}" aria-controls="step-panel" aria-selected="false" tabindex="-1" data-step="${index}" type="button"><span class="tab-number">${String(index + 1).padStart(2, "0")}</span><span class="tab-name">${step.nav}</span></button>`).join("");
  refs.nodes.innerHTML = nodes.map((node, index) => `<div class="flow-pair"><div class="flow-node" data-node="${index}" aria-label="${node.name}: ${node.sub}"><small>${node.label}</small><span class="node-icon" aria-hidden="true">${node.icon}</span><div><strong>${node.name}</strong><span class="node-sub">${node.sub}</span></div></div>${index < nodes.length - 1 ? '<span class="flow-connector" aria-hidden="true"></span>' : ""}</div>`).join("");
  refs.extras.innerHTML = additions.map((item, index) => `<div class="extra-chip" data-extra="${index}"><span>${item.label}</span><strong>${item.name}</strong></div>`).join("");
}

function render() {
  const step = steps[currentStep];
  const declined = outcome === "declined" && currentStep >= 4;
  refs.count.textContent = `${String(currentStep + 1).padStart(2, "0")} / 08`;
  refs.progress.style.width = `${(currentStep + 1) / steps.length * 100}%`;
  refs.number.textContent = `STEP ${String(currentStep + 1).padStart(2, "0")}`;
  refs.tag.textContent = step.tag;
  refs.title.textContent = step.title;
  refs.description.textContent = step.description;
  refs.add.textContent = step.add;
  refs.why.textContent = step.why;
  refs.tech.textContent = step.tech;
  refs.takeaway.textContent = declined && currentStep >= 5
    ? "The issuer declined this attempt. No capture, clearing, or settlement follows. The shopper can try another way to pay."
    : step.takeaway;
  refs.status.textContent = declined ? "Issuer declined this attempt" : step.status;
  refs.previous.disabled = currentStep === 0;
  refs.next.innerHTML = currentStep === steps.length - 1 ? 'Start again <span aria-hidden="true">↺</span>' : 'Next step <span aria-hidden="true">→</span>';

  refs.nav.querySelectorAll(".step-tab").forEach((tab, index) => {
    tab.setAttribute("aria-selected", String(index === currentStep));
    tab.tabIndex = index === currentStep ? 0 : -1;
    tab.classList.toggle("completed", index < currentStep);
  });

  refs.nodes.querySelectorAll(".flow-node").forEach((nodeEl, index) => {
    const source = nodes[index];
    nodeEl.classList.toggle("active", currentStep >= source.from);
    nodeEl.classList.toggle("new", currentStep === source.from);
    nodeEl.classList.toggle("decision-node", index === nodes.length - 1 && currentStep >= 4);
    nodeEl.classList.toggle("approved", index === nodes.length - 1 && currentStep >= 4 && !declined);
    nodeEl.classList.toggle("declined", index === nodes.length - 1 && declined);
  });
  refs.nodes.querySelectorAll(".flow-connector").forEach((line, index) => {
    line.classList.toggle("active", currentStep >= nodes[index + 1].from);
  });

  refs.response.classList.toggle("active", currentStep >= 4);
  refs.response.classList.toggle("declined", declined);
  refs.responseLabel.textContent = currentStep < 4 ? "Issuer sends its decision back" : declined
    ? "Declined: the store asks for another payment method"
    : "Approved: the issuer sends its decision back";
  refs.scenarios.querySelectorAll(".scenario-button").forEach(button => {
    const selected = button.dataset.outcome === outcome;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    button.disabled = currentStep < 4;
  });
  refs.extras.querySelectorAll(".extra-chip").forEach((chip, index) => {
    chip.classList.toggle("active", currentStep >= additions[index].from);
    chip.classList.toggle("new", currentStep === additions[index].from);
    chip.classList.toggle("muted", declined && index === 1);
  });
}

function selectStep(index, focusTab = false) {
  currentStep = Math.max(0, Math.min(steps.length - 1, index));
  render();
  if (focusTab) refs.nav.querySelector(`[data-step="${currentStep}"]`).focus();
}

buildStaticUI();
render();

refs.nav.addEventListener("click", event => {
  const tab = event.target.closest(".step-tab");
  if (tab) selectStep(Number(tab.dataset.step));
});
refs.nav.addEventListener("keydown", event => {
  const next = event.key === "ArrowRight" ? currentStep + 1 : event.key === "ArrowLeft" ? currentStep - 1 : event.key === "Home" ? 0 : event.key === "End" ? steps.length - 1 : null;
  if (next === null) return;
  event.preventDefault();
  selectStep(next, true);
});
refs.previous.addEventListener("click", () => selectStep(currentStep - 1));
refs.next.addEventListener("click", () => selectStep(currentStep === steps.length - 1 ? 0 : currentStep + 1));
refs.scenarios.addEventListener("click", event => {
  const button = event.target.closest(".scenario-button");
  if (!button || currentStep < 4) return;
  outcome = button.dataset.outcome;
  render();
});
