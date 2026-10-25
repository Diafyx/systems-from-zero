// One reserved seat, replayed as the design grows. IDs and timings are teaching examples.
const sources = {
  rows:["PostgreSQL row locks and concurrent updates","https://www.postgresql.org/docs/current/transaction-iso.html"],
  returning:["PostgreSQL UPDATE ... RETURNING","https://www.postgresql.org/docs/current/sql-update.html"],
  constraints:["PostgreSQL unique constraints","https://www.postgresql.org/docs/current/ddl-constraints.html"],
  hold:["Stripe: separate authorization and capture","https://docs.stripe.com/payments/place-a-hold-on-a-payment-method"],
  capture:["Stripe: capture a PaymentIntent","https://docs.stripe.com/api/payment_intents/capture"],
  retry:["Stripe: idempotent requests","https://docs.stripe.com/api/idempotent_requests"],
  webhook:["Stripe: receive webhook events","https://docs.stripe.com/webhooks"],
  outbox:["AWS: transactional outbox pattern","https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html"],
  waiting:["Cloudflare Waiting Room","https://developers.cloudflare.com/waiting-room/about/"]
};

const participants = [
  {name:"Nina's browser",detail:"seat map, checkout, ticket",added:0},
  {name:"Booking API",detail:"validates requests and controls state",added:0},
  {name:"PostgreSQL",detail:"one authoritative row per event seat",added:0},
  {name:"Stripe",detail:"card authorization and capture",added:8},
  {name:"Outbox worker",detail:"issues and sends one ticket",added:12},
  {name:"Gate scanner",detail:"checks ticket use online",added:13},
  {name:"Waiting Room",detail:"meters admission during a rush",added:16}
];

const layers = [
  {name:"First version",until:4,items:[
    {at:0,label:"Seat A-12"},{at:1,label:"Seat map"},{at:2,label:"Read, then book"},{at:3,label:"Two buyers race"}
  ]},
  {name:"Seat claim",items:[
    {at:4,label:"Atomic claim"},{at:5,label:"Timed hold"},{at:6,label:"Expiry rule"},{at:7,label:"Retry key"}
  ]},
  {name:"Payment",items:[
    {at:8,label:"Authorize"},{at:9,label:"FINALIZING"},{at:10,label:"Capture"},{at:11,label:"SOLD + outbox"}
  ]},
  {name:"Entry and scale",items:[
    {at:12,label:"Ticket"},{at:13,label:"One gate entry"},{at:14,label:"Seat groups"},{at:15,label:"Recovery"},{at:16,label:"Rush control"}
  ]}
];

const steps = [
  {
    name:"Name the seat",title:"Start with one event and one seat.",
    lead:"Nina wants seat A-12 for a concert. Create one row for that seat under event E7. The row begins AVAILABLE. Its identity never changes when buyers, holds, or payments change.",
    focus:["Booking API","PostgreSQL"],signal:"(E7, A-12) = AVAILABLE",
    from:"Event setup",to:"PostgreSQL event_seats",message:"event_id=E7; seat_id=A-12; state=AVAILABLE; price_cents=5000.",
    state:"Exactly one row represents this seat for this event.",
    why:"A seat needs one place where the system can decide who owns it.",
    build:"Use PRIMARY KEY (event_id, seat_id). Store an event seat's state, hold ID, expiry, and order ID on that row. Keep price in cents in the event listing and copy the accepted price to checkout.",
    inside:"A-12 alone is not unique: another event can also have an A-12. The event ID makes the identity precise.",
    failure:"Duplicate seat rows would let two requests claim different copies. Reject duplicates at the database constraint, not just in API code.",
    rule:"Every reserved seat has one authoritative row.",source:"constraints"
  },
  {
    name:"Show availability",title:"The map is a snapshot, not a promise.",
    lead:"Nina opens the seat map and sees A-12 as available. Leo opens the same map a moment later. Both screens can be accurate when loaded and stale seconds later.",
    focus:["Nina's browser","Booking API","PostgreSQL"],signal:"GET /events/E7/seats",
    from:"PostgreSQL seat rows",to:"Nina and Leo's browsers",message:"A-12: AVAILABLE at read time; price $50.",
    state:"Both buyers may click the same seat. Neither owns it yet.",
    why:"People need to choose a seat before checkout, but reading a state does not reserve it.",
    build:"Return seat ID, display price, and current public status. Treat the result as a hint. Recheck ownership during the write that claims the seat.",
    inside:"A cache can later serve this map. The cache may lag, so its answer must never be the final purchase decision.",
    failure:"If the page labels A-12 available after someone claims it, the claim endpoint returns unavailable and the UI refreshes the map.",
    rule:"A green seat on the map is not a reservation.",source:"rows"
  },
  {
    name:"Sell one seat",title:"A small first version appears to work.",
    lead:"With Nina as the only buyer, the API reads AVAILABLE, inserts booking B1, and shows her a confirmation. This first version has no card payment or timed hold yet.",
    focus:["Nina's browser","Booking API","PostgreSQL"],signal:"Read AVAILABLE → insert B1",
    from:"Nina's click",to:"Booking API + bookings table",message:"E7; A-12; buyer=Nina → booking B1.",
    state:"One buyer gets one booking. The happy path hides a concurrency bug.",
    why:"A first working route makes the missing safeguard visible when traffic increases.",
    build:"Make a seat picker and a bookings table. Read status and insert a booking. This is a deliberately incomplete first version, replayed as a safer design in the next steps.",
    inside:"A confirmation created after a separate read has no single atomic ownership decision.",
    failure:"Two API workers can both read AVAILABLE before either inserts. Both may confirm unless the database enforces ownership.",
    rule:"A successful one-person test does not prove two-person safety.",source:"rows"
  },
  {
    name:"Watch the race",title:"Nina and Leo both see AVAILABLE.",
    lead:"At 12:00:00.100, Nina's request reads AVAILABLE. At 12:00:00.101, Leo's request reads AVAILABLE. Nina inserts B1; Leo inserts B2. The separate read gave neither request exclusive ownership.",
    focus:["Nina's browser","Booking API","PostgreSQL"],signal:"B1 and B2 both claim A-12",
    from:"Two booking requests",to:"Two API workers",message:"Nina read AVAILABLE; Leo read AVAILABLE; both insert a booking.",
    state:"The first design can double book one seat.",
    why:"The exact interleaving shows why a frontend lock or a faster read cannot fix the race.",
    build:"Run a concurrent request test that pauses both workers after the read and releases them together. Assert that no more than one buyer can win.",
    inside:"Even one API process can interleave requests; adding servers makes the race easier to hit. A unique constraint on active ownership or one seat row with a guarded update is needed.",
    failure:"A test that sends requests one after another will miss this bug. Force overlap at the ownership decision.",
    rule:"The read and the ownership decision must be one guarded database operation.",source:"rows"
  },
  {
    name:"Claim atomically",title:"Let one database update pick the winner.",
    lead:"Replay the same hypothetical purchase. Nina and Leo now ask PostgreSQL to change A-12 from AVAILABLE to HELD. One guarded UPDATE returns the row; the other returns zero rows after the winner commits.",
    focus:["Booking API","PostgreSQL"],signal:"One UPDATE; one winner",
    from:"POST /holds for E7/A-12",to:"PostgreSQL conditional UPDATE",message:"Change AVAILABLE → HELD only if still AVAILABLE; RETURNING seat_id.",
    state:"Only the winner receives a hold ID. The loser sees 'seat no longer available'.",
    why:"The database row is the shared point all API workers must pass through.",
    build:"Use a conditional UPDATE ... RETURNING against the primary-key seat row. Check that exactly one row returned. PostgreSQL row locking makes concurrent updates of this row wait and recheck the condition.",
    inside:"At READ COMMITTED, the second UPDATE waits for the first row update and checks the new row state. It no longer matches AVAILABLE, so it updates zero rows.",
    failure:"Do not trust the browser's selected state or an application memory lock; another worker or region may not share it.",
    rule:"The database write decides ownership; the map only suggests it.",source:"rows"
  },
  {
    name:"Add a short hold",title:"Give the winner time to pay.",
    lead:"Nina wins hold H1. The server sets hold_expires_at to 12:05:00. A-12 appears held to other buyers while Nina enters payment details.",
    focus:["Nina's browser","Booking API","PostgreSQL"],signal:"HELD by H1 until 12:05",
    from:"Successful seat claim",to:"Seat row + Nina's checkout",message:"hold_id=H1; expires_at=12:05:00 UTC; owner=Nina.",
    state:"A-12 is temporarily unavailable, not sold.",
    why:"Without a deadline, an abandoned checkout can block the seat forever.",
    build:"Store the deadline in PostgreSQL using server time. Return it to the browser for a countdown. Every later transition checks H1 and the database deadline.",
    inside:"The browser timer is display only. Client clocks can be wrong or altered. The database expiry is the authority.",
    failure:"A countdown reaching zero does not by itself release the row. A sweeper or a later claim must apply the expiry rule in the database.",
    rule:"A hold is an expiring claim, not a completed sale.",source:"returning"
  },
  {
    name:"Reclaim an expired hold",title:"The next buyer can take an abandoned seat.",
    lead:"If Nina stops at checkout, H1 expires. Leo's guarded UPDATE may claim A-12 only while its state is HELD and its deadline is in the past. It replaces H1 with H2 in one write.",
    focus:["Booking API","PostgreSQL"],signal:"Expired H1 → H2",
    from:"Leo's hold request",to:"PostgreSQL seat row",message:"Accept AVAILABLE or expired HELD; never accept FINALIZING or SOLD.",
    state:"Leo can proceed; H1 can no longer finish checkout.",
    why:"A separate cleanup job can run late. The claim path itself must handle expiry safely.",
    build:"Extend the conditional UPDATE predicate to include (state='HELD' AND hold_expires_at < clock_timestamp()). Replace hold_id and deadline together. Any H1 checkout must check its exact hold ID before finishing.",
    inside:"An expiry sweeper can tidy rows for display, but correctness comes from the same guarded claim and finish predicates. The precise expiry boundary belongs to the database clock.",
    failure:"If H1 later returns from a payment screen, its finalize UPDATE returns zero. Cancel its uncaptured authorization and show the lost-seat result.",
    rule:"An expired hold can be replaced; an old hold ID cannot reclaim it.",source:"rows"
  },
  {
    name:"Make checkout retry safe",title:"A double click stays one attempt.",
    lead:"Nina submits checkout twice because the first response is slow. Both requests carry checkout key C1 for hold H1 and the accepted $50 price. The API returns the same order attempt O1.",
    focus:["Nina's browser","Booking API","PostgreSQL"],signal:"C1 → O1 every time",
    from:"Nina's checkout button",to:"Booking API orders table",message:"checkout_key=C1; hold_id=H1; amount_cents=5000.",
    state:"One hold links to one checkout attempt and one payment attempt.",
    why:"Network retries and double clicks are routine; they should not create two charges or tickets.",
    build:"Give orders a unique checkout_key and bind the key to buyer, seat, amount, and hold. On the same-key retry, return O1; reject the key if its details differ. Persist the Stripe PaymentIntent ID on O1.",
    inside:"The checkout key protects the application's order. Stripe also needs its own stable idempotency key for create and capture calls.",
    failure:"A new random key on every retry defeats deduplication. A reused key with changed amount must be rejected.",
    rule:"A retry repeats the same intent; it does not start a second purchase.",source:"retry"
  },
  {
    name:"Authorize the card",title:"Check payment while H1 still owns the seat.",
    lead:"The API creates Stripe PaymentIntent P1 for $50 with manual capture. Nina completes any required card authentication. A confirmed P1 reaches requires_capture: the card is authorized, but money has not been captured.",
    focus:["Nina's browser","Booking API","Stripe","PostgreSQL"],signal:"P1 = requires_capture",
    from:"Order attempt O1",to:"Stripe PaymentIntent P1",message:"amount=5000 USD cents; capture_method=manual; metadata order=O1.",
    state:"Nina has an authorization and H1 is still a temporary hold.",
    why:"The site should verify a payable card before it promises a sold seat.",
    build:"Collect card data through Stripe's client-side UI. The server creates P1 once with an idempotency key and stores P1 on O1. Confirm and handle requires_action before expecting requires_capture.",
    inside:"Manual capture is for eligible payment methods. The authorization has its own expiry, separate from the site's five-minute seat hold.",
    failure:"If authorization is declined, keep H1 only until its normal deadline. If authentication takes too long, H1 may expire even when P1 later authorizes.",
    rule:"Authorized funds are not captured funds, and neither alone proves seat ownership.",source:"hold"
  },
  {
    name:"Freeze the seat",title:"Cross the hold deadline before capture.",
    lead:"The API asks PostgreSQL to change A-12 from HELD by H1 to FINALIZING for O1, but only if H1 still matches and its deadline has not passed. After this commit, expiry cannot give the seat to Leo.",
    focus:["Booking API","PostgreSQL"],signal:"HELD H1 → FINALIZING O1",
    from:"Authorized P1 + O1",to:"PostgreSQL guarded transition",message:"state=HELD; hold_id=H1; not expired → FINALIZING; order_id=O1.",
    state:"The seat is blocked while capture outcome is determined.",
    why:"Capturing before locking out expiry could charge Nina while Leo takes the seat.",
    build:"Commit a compare-and-set UPDATE using the hold ID and live deadline. Only one transition can succeed. If it returns zero rows, cancel the uncaptured P1 and do not capture.",
    inside:"FINALIZING is deliberately neither HELD nor SOLD. The hold deadline no longer releases it; a recovery worker later resolves this state from P1.",
    failure:"Never run a generic 'expired hold' cleanup against FINALIZING. It could release a seat whose capture is underway.",
    rule:"Close the expiry race before asking the payment provider to capture.",source:"rows"
  },
  {
    name:"Capture once",title:"Take the $50 against the frozen seat.",
    lead:"The API calls Stripe to capture P1 with a stable operation key. Stripe reports succeeded. If the response times out, A-12 stays FINALIZING until the API retrieves P1 and learns the actual result.",
    focus:["Booking API","Stripe","PostgreSQL"],signal:"P1 requires_capture → succeeded",
    from:"Booking API capture operation",to:"Stripe P1",message:"capture P1; key=order:O1:capture:v1; expected amount=5000.",
    state:"Payment is captured if P1 is succeeded; the seat still awaits SOLD commit.",
    why:"A network timeout cannot tell whether Stripe captured the payment. Releasing the seat then would risk a paid buyer losing it.",
    build:"Persist the capture operation key on O1, call capture once, and retrieve P1 after uncertain replies. Retry only the same operation and parameters according to Stripe's idempotency rules.",
    inside:"A provider idempotency key is not permanent storage; keep your own durable O1→P1 record and reconcile by PaymentIntent ID.",
    failure:"If P1 is still requires_capture, retry or cancel within the authorization window. If it is succeeded, never attempt a fresh PaymentIntent for this order.",
    rule:"Unknown capture result means investigate, not release or charge again.",source:"capture"
  },
  {
    name:"Mark SOLD",title:"Commit ownership and ticket work together.",
    lead:"After confirming P1 succeeded, one PostgreSQL transaction changes FINALIZING O1 to SOLD, marks O1 PAID, and writes TicketRequested(O1) to an outbox table. Nina can now see an order confirmation.",
    focus:["Booking API","PostgreSQL"],signal:"SOLD + PAID + outbox",
    from:"Confirmed Stripe P1 status",to:"Seat, order, and outbox rows",message:"E7/A-12 SOLD to O1; O1 PAID; event TicketRequested(O1).",
    state:"A-12 cannot be claimed again. Ticket issue has a durable task.",
    why:"If the order commits but the ticket message is lost, Nina paid and has no ticket. The outbox row closes that database-to-worker gap.",
    build:"Use one database transaction for seat SOLD, order PAID, and outbox INSERT. Guard the seat by FINALIZING + O1. Enforce a unique active ticket per (event_id, seat_id) as defense in depth.",
    inside:"The outbox relay may send the same event more than once. The ticket worker must use O1 as an idempotent key.",
    failure:"If this commit fails after Stripe succeeded, keep FINALIZING and retry the same guarded transaction. Do not sell A-12 to Leo.",
    rule:"Captured payment and sold seat converge through a recoverable state.",source:"outbox"
  },
  {
    name:"Issue one ticket",title:"Turn the paid seat into entry proof.",
    lead:"The outbox worker creates ticket T1 for O1 and A-12, then sends Nina a link. A QR code carries a high-entropy opaque token; the server stores its hash and can revoke or rotate it.",
    focus:["Outbox worker","PostgreSQL","Nina's browser"],signal:"O1 → ticket T1",
    from:"TicketRequested(O1)",to:"Ticket T1 + Nina's account",message:"ticket_id=T1; event=E7; seat=A-12; token hash; status=VALID.",
    state:"Nina can open one valid ticket for the paid seat.",
    why:"The ticket must be issued after payment and seat ownership, even if email or push delivery is delayed.",
    build:"Give tickets a unique order ID and seat identity. Generate a random opaque token; store only its hash. Render it as QR and show it behind authenticated account access. Email carries a link, not the source of truth.",
    inside:"QR is just a way to carry bytes. A screenshot can be copied; only an online check against current ticket status determines whether it is usable.",
    failure:"If the worker gets a duplicate event, it returns existing T1. If email fails, Nina can still retrieve T1 from her account while delivery retries.",
    rule:"One paid seat yields one active ticket record.",source:"outbox"
  },
  {
    name:"Scan at the gate",title:"Two scanners cannot admit one ticket twice.",
    lead:"At the venue, the scanner reads T1's token and sends it to the gate API. One guarded UPDATE changes VALID to USED and records the time. A second simultaneous scan returns zero rows and is rejected.",
    focus:["Gate scanner","Booking API","PostgreSQL"],signal:"T1 VALID → USED once",
    from:"QR token at entrance",to:"Gate API + tickets table",message:"hash token; event E7; status VALID → USED; checked_in_at=server time.",
    state:"Nina is admitted once. A duplicate or revoked token is denied.",
    why:"A QR image is copyable, and two gates can scan copies at nearly the same time.",
    build:"Require authenticated online scanners. Hash the presented token, match event and VALID status, then UPDATE ... RETURNING. Display the admitted seat and timestamp to gate staff.",
    inside:"Offline scanning requires a separate conflict policy because scanners cannot all consult the same current state; this design uses online gates.",
    failure:"If the gate loses connectivity, do not silently mark an unchecked token valid. Use a documented manual exception process and reconcile later.",
    rule:"Entry is a second atomic claim, this time against the ticket.",source:"returning"
  },
  {
    name:"Sell adjacent seats",title:"An order with two seats is all or nothing.",
    lead:"For a later order, Mina selects A-13 and A-14. The API claims both seats inside one PostgreSQL transaction. If either is unavailable, it rolls back both claims before starting payment.",
    focus:["Booking API","PostgreSQL"],signal:"Two claims; one commit",
    from:"Mina's two-seat request",to:"PostgreSQL event_seats",message:"Claim A-13 and A-14 in sorted seat order; commit only if both succeed.",
    state:"Mina gets both seats or neither, never an accidental half order.",
    why:"A group checkout needs a clear promise. Charging for two seats when only one was held is a poor outcome.",
    build:"Within one short transaction, lock/claim requested seat rows in stable seat-ID order, check the claimed count, and roll back on any miss. Then create one checkout attempt for that seat set and amount; later move the whole set to FINALIZING and SOLD together.",
    inside:"Stable ordering reduces deadlocks when buyers overlap on the same set. If the database still reports a deadlock, retry the whole transaction with the same checkout intent.",
    failure:"Never hold one seat while waiting for a slow payment call to claim the second. Commit the full group hold before contacting Stripe.",
    rule:"A multi-seat hold is one database transaction.",source:"rows"
  },
  {
    name:"Recover and revoke",title:"Finish uncertain work and record reversals.",
    lead:"A worker scans old FINALIZING rows. It retrieves each linked PaymentIntent: succeeded means finish SOLD; uncaptured or failed means cancel or release only after the provider state is known. A later refund revokes T1 without deleting its history.",
    focus:["Booking API","PostgreSQL","Stripe","Outbox worker"],signal:"Reconcile O1 ↔ P1 ↔ T1",
    from:"Stuck-state monitor or refund request",to:"Stripe status + local records",message:"P1 status, O1 state, seat state, T1 status; next safe transition.",
    state:"No paid seat quietly returns to inventory; a refunded ticket stops working.",
    why:"A database and a payment provider cannot share one local transaction. Crashes and delayed webhooks leave work to finish.",
    build:"Monitor FINALIZING age, retrieve P1, verify signed Stripe webhooks, dedupe event IDs, and use guarded transitions. On an approved pre-entry refund, record refund state and revoke T1; decide resale policy explicitly.",
    inside:"Webhooks can be retried and arrive out of order. They wake up reconciliation but do not replace a current provider status check when the outcome is uncertain.",
    failure:"Do not let a late 'payment succeeded' webhook resurrect a refunded or canceled ticket. Apply an allowed state transition against the current order and ticket state.",
    rule:"Unknown external outcomes stay blocked until reconciled.",source:"webhook"
  },
  {
    name:"Handle the rush",title:"Protect the claim path during a big sale.",
    lead:"Thousands of fans may refresh E7 at once. A waiting room meters entry, and a cached seat map absorbs reads. Every hold, expiry replacement, and finalization still goes through PostgreSQL's guarded seat row.",
    focus:["Waiting Room","Nina's browser","Booking API","PostgreSQL"],signal:"Queue reads; keep one write authority",
    from:"Sale traffic spike",to:"Waiting Room + map cache + booking API",message:"Admit a controlled rate; read cached map; claim A-12 in PostgreSQL.",
    state:"The site stays responsive without changing the ownership rule.",
    why:"A popular sale can overwhelm app and database connections before the seat rule even runs.",
    build:"Set admission limits for the event path, cache public seat status briefly, cap database connections, rate-limit hold creation, and measure claim latency, rejected claims, expired holds, and stuck FINALIZING rows.",
    inside:"The waiting room controls arrival rate, not which buyer owns A-12. A stale cached map can show an unavailable seat; the authoritative UPDATE still rejects it.",
    failure:"A Redis lock alone must not become seat ownership. If it expires during capture or disagrees with PostgreSQL, two systems can make conflicting promises.",
    rule:"Scale the reads and admission; keep the seat claim authoritative.",source:"waiting"
  }
];
