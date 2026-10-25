const sources = {
  fulfillment:["Shopify: fulfillment order lifecycle", "https://shopify.dev/docs/apps/build/orders-fulfillment/order-management-apps"],
  inventory:["PostgreSQL: UPDATE and RETURNING", "https://www.postgresql.org/docs/current/sql-update.html"],
  payment:["Stripe: PaymentIntent states", "https://docs.stripe.com/api/payment_intents"],
  idempotency:["Stripe: idempotent requests", "https://docs.stripe.com/api/idempotent_requests"],
  authorize:["Stripe: confirm a PaymentIntent", "https://docs.stripe.com/api/payment_intents/confirm"],
  capture:["Stripe: capture a PaymentIntent", "https://docs.stripe.com/api/payment_intents/capture"],
  cancel:["Stripe: cancel a PaymentIntent", "https://docs.stripe.com/api/payment_intents/cancel"],
  refund:["Stripe: refunds", "https://docs.stripe.com/api/refunds"],
  outbox:["AWS: transactional outbox", "https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html"],
  sqs:["AWS: SQS standard queue delivery", "https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues.html"],
  barcode:["GS1: barcodes and item IDs", "https://support.gs1.org/support/solutions/articles/43000734095-how-do-gs1-gtins-and-barcodes-work-"],
  label:["Shippo: purchase a shipping label", "https://docs.goshippo.com/shippoapi/public-api/transactions/createtransaction"],
  shippo:["Shippo: tracking webhooks", "https://docs.goshippo.com/tracking/webhooks"],
  shippoSecurity:["Shippo: webhook security", "https://docs.goshippo.com/tracking/webhook-security"],
  carrier:["UPS: tracking status meanings", "https://www.ups.com/us/en/support/tracking-support/where-is-my-package/understanding-tracking-status"],
  route:["Shopify: fulfillment routing", "https://shopify.dev/docs/api/admin-rest/2026-07/resources/fulfillmentorder"]
};

const participants = [
  {name:"Asha's browser",detail:"Places and tracks order",added:1},
  {name:"Store app",detail:"Owns order rules",added:0},
  {name:"PostgreSQL",detail:"Orders and stock",added:0},
  {name:"Stripe",detail:"Authorizes and captures",added:2},
  {name:"Warehouse",detail:"Picks and packs",added:3},
  {name:"Local driver",detail:"First delivery route",added:4,removed:5},
  {name:"SQS worker",detail:"Starts fulfillment",added:8},
  {name:"Shippo + UPS",detail:"Label and carrier updates",added:11}
];

const layers = [
  {name:"FIRST ROUTE",until:5,items:[{at:0,label:"SKU + stock"},{at:1,label:"Checkout"},{at:2,label:"Paid order"},{at:3,label:"Manual pack"},{at:4,label:"Local delivery"}]},
  {name:"SAFE CHECKOUT",items:[{at:5,label:"Retry key"},{at:6,label:"Stock hold"},{at:7,label:"Card authorization"},{at:8,label:"Placed + outbox"}]},
  {name:"FULFILL",items:[{at:9,label:"Warehouse task"},{at:10,label:"Pick scan"},{at:11,label:"Pack + label"},{at:12,label:"Capture"}]},
  {name:"DELIVER",items:[{at:13,label:"Handoff"},{at:14,label:"Carrier scans"},{at:15,label:"Delivered"},{at:16,label:"Exception / return"},{at:17,label:"More warehouses"}]}
];

const steps = [
  {
    name:"List one product",title:"Start with one real item in one stockroom.",
    lead:"The store lists blue running shoes, size 9, SKU RUN-BLU-09. Warehouse W1 physically has three pairs. The page shows the product and a price, but that display is only a snapshot.",
    focus:["Store app","PostgreSQL"],signal:"RUN-BLU-09 in stock",
    from:"Stockroom count",to:"Store app + PostgreSQL",message:"sku=RUN-BLU-09; warehouse=W1; on_hand=3; price=$80.",
    state:"Asha can add the shoes to her cart. No pair has been set aside for her.",
    why:"A system needs an exact item identity and a physical count before it can promise delivery.",
    build:"Store a product row and one stock row keyed by (warehouse_id, sku). Treat size 9 as a distinct SKU from other sizes.",
    inside:"A product page can lag behind stock changes. The final checkout must check stock again.",
    failure:"If staff never records damage or shrinkage, the database may say three while the shelf holds two.",
    rule:"A listing is an offer to try checkout, not a reservation.",source:"fulfillment"
  },
  {
    name:"Check out simply",title:"Asha gives an address and sees the final amount.",
    lead:"Asha chooses one pair and enters a delivery address. The server checks that it serves that address, calculates the final $88 total, and shows it before she confirms.",
    focus:["Asha's browser","Store app","PostgreSQL"],signal:"Final quote: $88",
    from:"Asha's browser",to:"Store app",message:"sku=RUN-BLU-09; quantity=1; address; server returns total=$88.",
    state:"Asha can accept the quote. No card charge or order exists yet.",
    why:"The customer must know the exact amount and delivery destination before placing an order.",
    build:"Validate required address fields and delivery coverage; calculate price, shipping, and applicable taxes on the server. Save a snapshot of the accepted total and address with the order.",
    inside:"The browser's price is not trusted. This example uses a final total of $88; its internal tax and shipping calculation is outside this flow.",
    failure:"A changed price or undeliverable address should stop checkout with a clear new quote.",
    rule:"The server owns the final order amount and address check.",source:"fulfillment"
  },
  {
    name:"Take the first payment",title:"The first version charges and creates the order.",
    lead:"One app server creates order o-41 and uses Stripe to capture the $88 card payment at checkout. When Stripe confirms success, the order becomes PAID and Asha gets a receipt.",
    focus:["Asha's browser","Store app","PostgreSQL","Stripe"],signal:"o-41 PAID",
    from:"Store app",to:"Stripe + PostgreSQL",message:"PaymentIntent for $88, automatic capture; order_id=o-41; payment_intent_id=pi-41.",
    state:"The store owes Asha one pair. A staff member must now find and deliver it.",
    why:"One order record and one payment integration make a useful first store.",
    build:"Create one PaymentIntent per order attempt, link its ID to o-41, and show confirmation only after the final payment status is known. Handle authentication steps if Stripe requests them.",
    inside:"This first route charges before anyone checks the physical shelf. If the pair is missing, the store must refund or resolve the order.",
    failure:"If the app loses the payment response, look up the PaymentIntent before attempting another charge. A timeout is not proof that payment failed.",
    rule:"A paid order is a promise to fulfill, not proof the item has shipped.",source:"payment"
  },
  {
    name:"Pack it by hand",title:"A person can fulfill the first few orders.",
    lead:"Staff open the PAID order, take one RUN-BLU-09 pair from the W1 shelf, check the size, box it, and write the order ID on a local delivery slip.",
    focus:["Store app","PostgreSQL","Warehouse"],signal:"Manual pick + pack",
    from:"Order o-41",to:"W1 staff",message:"One pair, size 9; Asha's address; box marked o-41.",
    state:"The parcel is packed in the stockroom, but it has not left the store.",
    why:"A small store can begin with a human checklist before adding warehouse software.",
    build:"Give staff a private order list with item, size, address, and a PACKED button. Record who packed it and when; subtract one from stock when it leaves the stockroom.",
    inside:"A screen tap cannot prove the right shoe size is in the box. Physical verification matters.",
    failure:"If the shelf is empty, pause the order, tell Asha, and refund or offer another outcome. Never mark it shipped to hide the shortage.",
    rule:"A packed parcel is not a delivered parcel.",source:"fulfillment"
  },
  {
    name:"Deliver locally",title:"The first route ends with a human delivery update.",
    lead:"A local driver takes the box to Asha. Staff mark o-41 DELIVERED only after the driver reports a completed handoff.",
    focus:["Local driver","Store app","PostgreSQL","Asha's browser"],signal:"Delivered by local driver",
    from:"Local driver",to:"Store app → Asha",message:"order_id=o-41; delivery outcome=DELIVERED; time and driver note.",
    state:"Asha has the shoes, and the order has reached its final happy state.",
    why:"This route proves the whole customer promise before adding warehouse and carrier integrations.",
    build:"Record driver assignment, handoff time, and delivery outcome. Show Asha the order status in her account.",
    inside:"A manual status is only as reliable as the driver's report. A dispute still needs investigation.",
    failure:"If Asha is unavailable, record an attempted delivery and arrange another attempt; do not call it delivered.",
    rule:"The first system works, but its manual checks and updates do not scale.",source:"fulfillment"
  },
  {
    name:"Replay with a retry key",title:"Now build the same order for a larger store.",
    lead:"Replay Asha's purchase through the upgraded route. Her browser sends POST /checkouts with a fresh checkout_key, c-41. A retry with c-41 must return the same pending order, not create another one.",
    focus:["Asha's browser","Store app","PostgreSQL"],signal:"checkout_key=c-41",
    from:"Asha's browser",to:"Store app + orders table",message:"POST /checkouts; c-41; RUN-BLU-09 × 1; address → o-41 PENDING_PAYMENT.",
    state:"One durable attempt exists. Stock and money have not been committed yet.",
    why:"A double click or dropped response must not create two orders or two card payments.",
    build:"Give each deliberate checkout attempt a random key and a unique database constraint. Save one order row and the accepted quote; return that row on exact retries.",
    inside:"The same key cannot be used for a different cart or amount. The browser key protects the store endpoint; Stripe needs its own stable idempotency key for each payment operation.",
    failure:"If the request times out, the browser asks for c-41 again. The app reads the existing attempt instead of starting over.",
    rule:"Retry the same attempt with the same identity and inputs.",source:"idempotency"
  },
  {
    name:"Reserve one pair",title:"Hold stock before promising it to Asha.",
    lead:"In PostgreSQL, W1 has on_hand=3 and reserved=0. A conditional update raises reserved to 1 only if on_hand minus reserved is at least one.",
    focus:["Store app","PostgreSQL"],signal:"W1 reserved: 0 → 1",
    from:"Order o-41",to:"Stock row (W1, RUN-BLU-09)",message:"UPDATE stock SET reserved=reserved+1 WHERE on_hand-reserved>=1; RETURNING reserved.",
    state:"Asha has a temporary claim on one pair; two remain available to other checkouts.",
    why:"Two customers can click Buy while only one unit remains. A read-then-write check can oversell.",
    build:"Use one database transaction to conditionally update the stock row and create a reservation tied to o-41 with an expiry. If no row returns, show out of stock.",
    inside:"This reservation starts HELD with an expiry. on_hand includes the physical pair until shipment; reserved removes it from sellable stock. Cancel or expire an unpaid order by decrementing reserved once.",
    failure:"A forgotten hold hides stock forever. Expire it carefully, and never release it twice.",
    rule:"Sellable stock is on_hand minus active reservations.",source:"inventory"
  },
  {
    name:"Authorize the card",title:"Check funds without taking them yet.",
    lead:"The app creates and confirms a Stripe PaymentIntent for $88 with manual capture. After any required customer authentication, success reaches requires_capture: funds are authorized, not captured.",
    focus:["Asha's browser","Store app","Stripe","PostgreSQL"],signal:"Stripe requires_capture",
    from:"Store app + Asha",to:"Stripe PaymentIntent",message:"amount=8800 USD cents; capture_method=manual; idempotency key=order:o-41:authorize-v1.",
    state:"The order has a stock hold and a card authorization. It can move to fulfillment.",
    why:"If the warehouse cannot pack the item, the store can cancel the authorization instead of refunding a captured payment.",
    build:"Use manual capture only for supported methods, handle requires_action, store the PaymentIntent ID, and reconcile uncertain API replies before retrying.",
    inside:"An authorization has a limited capture window. The order must be packed and captured before expiry or put on hold for a new payment decision.",
    failure:"If authorization fails, release the stock hold and return the order to a clear payment-failed state. Do not send it to the warehouse.",
    rule:"Authorized means funds are held; paid means the payment was captured.",source:"authorize"
  },
  {
    name:"Confirm and queue",title:"Commit the order and ask the warehouse once.",
    lead:"The app checks that o-41 still holds W1 stock, changes it to PLACED with payment AUTHORIZED, and inserts FulfillmentRequested(o-41,W1) into an outbox in the same PostgreSQL transaction. A relay sends it to SQS.",
    focus:["Store app","PostgreSQL","SQS worker"],signal:"PLACED + outbox event",
    from:"Order transaction",to:"Outbox → SQS worker",message:"order_id=o-41; warehouse=W1; event_id=e-41; type=FulfillmentRequested.",
    state:"Asha sees a placed order; W1 has durable work to pick it.",
    why:"The database commit can succeed while sending a separate queue message fails. The outbox closes that gap.",
    build:"In one transaction, verify the HELD stock reservation is still active, change it to COMMITTED with no expiry, set PLACED, and insert the outbox row. Relay unsent rows to SQS. Give the worker a unique (order_id, fulfillment_type) key.",
    inside:"SQS standard delivery is at least once and can be out of order. The outbox relay can also send the same event twice after a crash. Consumers must handle duplicates.",
    failure:"If the hold expired during card authentication, re-reserve or cancel the authorization; do not promise stock that is gone. If the relay stops, alert on outbox age and retry.",
    rule:"A committed order must have a durable path to fulfillment.",source:"outbox"
  },
  {
    name:"Make a pick task",title:"W1 receives exact warehouse work.",
    lead:"The fulfillment worker creates task p-41 for W1: find one RUN-BLU-09 pair at bin B-12. The task carries the order ID, SKU, quantity, and destination for packing.",
    focus:["SQS worker","Warehouse","PostgreSQL"],signal:"Pick task p-41",
    from:"SQS FulfillmentRequested",to:"W1 warehouse task list",message:"p-41: bin B-12; sku RUN-BLU-09; quantity 1; order o-41.",
    state:"A picker can start work. The shoes are still physically in W1.",
    why:"The warehouse needs a specific instruction, not a vague 'new order' notification.",
    build:"Create one pick task per fulfillment unit, map SKU to bin, and show the task on a handheld or staff screen. Make task creation idempotent for o-41.",
    inside:"A WMS is warehouse management software. The app's reservation is a promise in the database; the pick task tells a person where to find the item.",
    failure:"If W1 cannot find the item, mark PICK_EXCEPTION, count the shelf, and stop capture and label purchase. Resolve or cancel before shipping.",
    rule:"The warehouse task turns an order record into physical work.",source:"fulfillment"
  },
  {
    name:"Scan the right item",title:"The picker verifies the size before packing.",
    lead:"At bin B-12, the picker scans the product barcode. The WMS maps that code to RUN-BLU-09 and accepts the pick only for the requested size and quantity.",
    focus:["Warehouse","PostgreSQL"],signal:"Correct SKU scanned",
    from:"Physical shoe box barcode",to:"WMS pick task p-41",message:"scanned product ID → RUN-BLU-09; picked_qty=1; picker and time saved.",
    state:"One matching pair is at the packing station; the payment is authorized but not captured.",
    why:"A size 10 box can look like size 9. Scanning catches many wrong-item errors before dispatch.",
    build:"Map the barcode product ID to the internal SKU, require a matching scan, and record exceptions for unreadable or mismatched codes.",
    inside:"A barcode identifies a product type, not necessarily one unique pair. The scanned item also needs human inspection for damage.",
    failure:"A wrong scan stops the task. Do not let staff close it as PICKED merely because the right SKU appeared on screen.",
    rule:"The pick is complete only when the physical item matches the order.",source:"barcode"
  },
  {
    name:"Pack and buy a label",title:"The box becomes a trackable parcel.",
    lead:"The packer checks the pair, seals the box, records weight and size, then buys a UPS label through Shippo. A successful label transaction returns a label and tracking number.",
    focus:["Warehouse","Store app","PostgreSQL","Shippo + UPS"],signal:"Label created, not shipped",
    from:"Packed parcel + address",to:"Shippo label transaction",message:"o-41; sender W1; Asha address; parcel weight/dimensions; chosen UPS rate → tracking number.",
    state:"The parcel is ready at W1. UPS has not necessarily touched it.",
    why:"The carrier needs a readable label with destination, service, and tracking identity.",
    build:"Validate address and parcel data, request Shippo shipment rates, choose a UPS rate, and purchase one label with metadata=o-41. If the transaction is queued, wait for SUCCESS before printing and saving tracking.",
    inside:"Shippo transaction SUCCESS means a label was purchased. It does not prove carrier pickup. If the API reply is lost, look for the transaction before buying another label.",
    failure:"Wrong weight or address can cause a carrier adjustment or return. Correct it before handoff; preserve the old transaction for audit.",
    rule:"A tracking number is created before the physical shipment starts.",source:"label"
  },
  {
    name:"Capture before release",title:"Take the payment when the parcel is ready to leave.",
    lead:"With the exact pair packed and label ready, the app captures Asha's $88 authorized PaymentIntent. Stripe returns succeeded, and the parcel becomes READY_TO_HANDOFF.",
    focus:["Store app","Stripe","PostgreSQL","Warehouse"],signal:"AUTHORIZED → CAPTURED",
    from:"Store app",to:"Stripe capture endpoint",message:"payment_intent_id=pi-41; amount_to_capture=8800; operation key=order:o-41:capture-v1.",
    state:"The store has captured payment and can release the parcel to UPS.",
    why:"Capture after packing avoids taking funds for a pair that cannot be found; capture before handoff avoids shipping without payment.",
    build:"Capture once with a stable idempotency key, verify Stripe's resulting status, and gate the warehouse release on CAPTURED. Watch authorization expiry.",
    inside:"Stripe's requires_capture is different from succeeded. If the authorization expires, capture fails; the store must stop shipment and ask Asha to resolve payment.",
    failure:"A capture timeout is uncertain. Read the PaymentIntent before retrying; never treat a network error as permission to capture a second payment.",
    rule:"Do not hand a parcel to the carrier until capture is confirmed.",source:"capture"
  },
  {
    name:"Hand it to the carrier",title:"The merchant and carrier cross a physical boundary.",
    lead:"W1 scans the labeled parcel onto its UPS pickup manifest and gives it to the driver. The store records HANDED_OFF and consumes the stock hold: on_hand 3→2 and reserved 1→0.",
    focus:["Warehouse","Shippo + UPS","PostgreSQL"],signal:"Parcel handed off",
    from:"W1 pack station",to:"UPS pickup driver",message:"tracking number + parcel; handoff time and manifest reference.",
    state:"The parcel left the store. The carrier's first tracking scan may arrive later.",
    why:"A label and a packed box can still sit in the warehouse; handoff is a separate event.",
    build:"Record the manifest and scan each parcel at dock release. Move reserved stock out of on_hand once per shipment, and store the carrier tracking ID on shipment s-41.",
    inside:"The merchant's HANDED_OFF event and carrier's accepted scan are separate evidence. Do not show 'in transit' solely because a label exists.",
    failure:"If the carrier never shows a first scan, investigate the dock manifest and pickup with the carrier before promising a delivery date.",
    rule:"Merchant handoff is not the same as a carrier tracking update.",source:"carrier"
  },
  {
    name:"Travel through UPS",title:"Scans show milestones, not a live dot on a map.",
    lead:"UPS accepts the parcel, moves it through its network, and later scans it at a local facility and onto a delivery vehicle. The exact buildings and route vary by shipment.",
    focus:["Shippo + UPS","Asha's browser"],signal:"IN_TRANSIT → OUT_FOR_DELIVERY",
    from:"UPS scan events",to:"Carrier tracking record",message:"accepted; facility arrival/departure; out for delivery; event times.",
    state:"Asha can see progress, but there may be gaps between scans.",
    why:"The customer needs meaningful milestones after the parcel leaves the store.",
    build:"Map carrier statuses into a small customer timeline. Show the carrier's reported event time and an estimate only when one is provided.",
    inside:"Tracking is scan based. A parcel may move between scans, and a facility scan is not a precise current location. A label-created status means the carrier may not have the parcel.",
    failure:"A delayed scan should not erase the last known milestone or be presented as a lost parcel by itself.",
    rule:"Tracking tells what was reported, not where the parcel is every second.",source:"carrier"
  },
  {
    name:"Record delivery",title:"The final carrier event closes the shipment.",
    lead:"UPS reports DELIVERED. Shippo sends a track_updated event; the store validates it, matches its tracking number to s-41, records the event, and shows Asha that delivery was reported.",
    focus:["Shippo + UPS","Store app","PostgreSQL","Asha's browser"],signal:"s-41 DELIVERED",
    from:"Shippo track_updated webhook",to:"Store tracking ledger + Asha",message:"carrier=UPS; tracking_number; status=DELIVERED; carrier event time.",
    state:"The carrier reports delivery. Asha can still raise a missing or damaged parcel issue.",
    why:"The store needs a durable status independent of Asha refreshing the carrier page.",
    build:"Secure the webhook using Shippo's configured method, dedupe repeated events, preserve original carrier timestamps, and reconcile with a tracking GET if updates conflict or stop.",
    inside:"Shippo tracking updates can arrive after carrier scans, and callbacks can be delayed. Do not roll a DELIVERED shipment back to IN_TRANSIT because an older event arrived later.",
    failure:"A fake or mismatched webhook must not mark an order delivered. Confirm the tracking ID and configured webhook authentication.",
    rule:"Delivered is a carrier report, with a time and source, not an assumption from elapsed days.",source:"shippo"
  },
  {
    name:"Resolve an exception",title:"A real system needs a path when delivery goes wrong.",
    lead:"If UPS reports an address exception or Asha says the parcel is missing, open a case against s-41. If it returns to W1, inspect it before restocking; refund a captured payment according to the resolution.",
    focus:["Asha's browser","Store app","PostgreSQL","Stripe","Warehouse","Shippo + UPS"],signal:"Exception or return case",
    from:"Carrier event or Asha's report",to:"Support case + warehouse/payment actions",message:"case_id=r-41; order=o-41; evidence; next action; refund ID if issued.",
    state:"The original order remains auditable while the issue is investigated or resolved.",
    why:"A DELIVERED scan may be disputed; a failed delivery may send the parcel back. Neither outcome should disappear from the timeline.",
    build:"Keep a case record, carrier event history, and resolution state. Cancel an uncaptured authorization if packing fails; use a Stripe refund for a captured payment; restock only after a returned pair passes inspection.",
    inside:"A refund and inventory return are separate actions. A returned damaged pair does not become sellable stock. A refund API call may be asynchronous or fail and needs reconciliation.",
    failure:"Blindly refunding twice or restocking on a mere return-in-transit scan loses money or oversells.",
    rule:"Compensation follows the actual payment and physical item state.",source:"refund"
  },
  {
    name:"Grow past one warehouse",title:"Route the next order to a warehouse that can fulfill it.",
    lead:"For future orders, add W2. The store chooses a warehouse with sellable stock that serves the address, then reserves that warehouse's SKU row before authorizing payment. Keep each shipment tied to its source warehouse.",
    focus:["Store app","PostgreSQL","Warehouse","SQS worker"],signal:"Route → reserve one location",
    from:"New order address + stock by location",to:"Selected warehouse + reservation",message:"Choose W1 or W2; reserve (warehouse_id,sku); fulfillment and shipment use that same location.",
    state:"The checkout still shows one order while fulfillment can originate from multiple locations over time.",
    why:"A single stockroom eventually runs out or cannot reach every customer quickly.",
    build:"Check service area, stock, and promised delivery before choosing. Reserve atomically at the chosen location; if that reservation loses a race, recalculate rather than pretending stock exists. Reconcile orders, stock holds, payments, labels, and carrier scans daily.",
    inside:"Splitting one order across warehouses would create multiple fulfillment tasks, parcels, tracking numbers, and possibly partial captures; this one-pair example does not need that branch.",
    failure:"A stale W2 count or lost event can leave an order stuck. Keep source-of-truth records and an exception queue for mismatches.",
    rule:"Warehouse choice and stock reservation must refer to the same physical location.",source:"route"
  }
];
