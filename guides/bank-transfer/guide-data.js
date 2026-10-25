// One $120 transfer, replayed as its route grows. Records and timings are teaching examples.
const sources = {
  transactions:["PostgreSQL: transactions","https://www.postgresql.org/docs/current/tutorial-transactions.html"],
  outbox:["AWS: transactional outbox pattern","https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html"],
  ach:["Nacha: how ACH payments work","https://www.nacha.org/content/how-ach-payments-work"],
  format:["Nacha developer guide: ACH file details","https://achdevguide.nacha.org/ach-file-details"],
  file:["Nacha developer guide: ACH file overview","https://achdevguide.nacha.org/ach-file-overview"],
  fedach:["Federal Reserve: ACH services","https://www.federalreserve.gov/paymentsystems/fedach_about.htm"],
  receipt:["Federal Reserve: FedACH origination and receipt","https://www.frbservices.org/financial-services/fedach-services/origination-receipt/"],
  schedule:["Federal Reserve: FedACH processing schedule","https://www.frbservices.org/resources/resource-centers/same-day-ach-resource-center/fedach-processing-schedule/"],
  availability:["Nacha: ACH schedules and funds availability","https://www.nacha.org/sites/default/files/2023-05/Same_Day_ACH_Schedules_and_Funds_Availability.pdf"],
  risk:["Nacha: ACH credit fraud monitoring","https://www.nacha.org/rules/risk-management-topics-fraud-monitoring-phase-2"],
  name:["Nacha: account number and receiver name","https://www.nacha.org/news/ach-operations-bulletin-2-2024-voluntary-formatting-standard-individual-name-field"],
  returns:["Nacha: ACH returns and return codes","https://www.nacha.org/news/ach-operations-bulletin-1-2025-same-day-processing-ach-returns-rdfis"],
  reversal:["Nacha: when an ACH reversal is allowed","https://www.nacha.org/news/second-chance-understanding-ach-reversals"],
  api:["Federal Reserve: FedACH status and settlement APIs","https://www.frbservices.org/fedline-solutions/fedline-developer/fedach-apis/"],
  fednow:["Federal Reserve: about the FedNow Service","https://www.frbservices.org/financial-services/fednow-service/about-fednow-service/"]
};

const participants = [
  {name:"Maya's app",detail:"request and honest status",added:0},
  {name:"Bank A service",detail:"accepts and tracks the transfer",added:0},
  {name:"Bank A ledger",detail:"balances and durable entries",added:0},
  {name:"Alex at Bank A",detail:"first version: same-bank credit",added:1,removed:3},
  {name:"ACH worker",detail:"outbox, batches, and file status",added:6},
  {name:"FedACH",detail:"operator and interbank settlement",added:8},
  {name:"Bank B",detail:"receiving bank for Alex",added:9},
  {name:"Alex at Bank B",detail:"recipient balance and notice",added:11}
];

const layers = [
  {name:"First route",until:3,items:[
    {at:0,label:"Transfer request"},{at:1,label:"Two ledger postings"},{at:2,label:"Retry key"}
  ]},
  {name:"Bank A",items:[
    {at:3,label:"External route"},{at:4,label:"Recipient checks"},{at:5,label:"Debit + payable"},{at:6,label:"Outbox"},{at:7,label:"ACH entry"}
  ]},
  {name:"ACH network",items:[
    {at:8,label:"File accepted"},{at:9,label:"Delivered to Bank B"},{at:10,label:"Interbank settlement"}
  ]},
  {name:"Finish and recover",items:[
    {at:11,label:"Recipient posting"},{at:12,label:"Availability"},{at:13,label:"Return"},{at:14,label:"Reversal rules"},{at:15,label:"Lost response"},{at:16,label:"Reconciliation"},{at:17,label:"Other rails"}
  ]}
];

const steps = [
  {
    name:"Enter the transfer",title:"Maya asks to send $120 to Alex.",
    lead:"Start with both people at Bank A. Maya chooses Alex, enters $120, and confirms. The app records a transfer request T1 with sender, recipient, amount in cents, and a request key K1.",
    focus:["Maya's app","Bank A service"],signal:"T1: send $120",
    from:"Maya's confirmation",to:"Bank A transfer service",message:"sender=Maya; recipient=Alex; amount_cents=12000; request_key=K1.",
    state:"Bank A has an instruction, not a completed transfer.",
    why:"A payment begins as an instruction. The app needs a stable identity for that instruction before balances move.",
    build:"Authenticate Maya, show the exact recipient and amount before confirmation, create T1, and bind K1 to the request details. Store money in integer cents.",
    inside:"The sender's login session proves who submitted the request; it does not by itself prove that Bank A posted money or Bank B received it.",
    failure:"If the app times out before showing a result, retry K1 or fetch T1. Do not make a second transfer with a fresh key just because the screen stayed blank.",
    rule:"A transfer request is not yet a movement of money.",source:"transactions"
  },
  {
    name:"Move it inside one bank",title:"Two customer balances change in one transaction.",
    lead:"Bank A checks Maya's available $300 and posts a $120 debit to Maya and a $120 credit to Alex. The same database transaction records both ledger entries and marks T1 POSTED.",
    focus:["Bank A service","Bank A ledger","Alex at Bank A"],signal:"Maya −$120; Alex +$120",
    from:"Bank A transfer service",to:"Bank A ledger",message:"T1: debit Maya deposit $120; credit Alex deposit $120; commit together.",
    state:"Maya has $180 available; Alex has $120 more. Both changes commit or neither does.",
    why:"One bank owns both accounts, so a local atomic transaction is enough for this first route.",
    build:"Guard Maya's available balance, insert balanced ledger entries with T1, update any balance projection, and commit in one PostgreSQL transaction. Reject insufficient funds with no partial entry.",
    inside:"Customer deposits are bank liabilities. In accounting terms Bank A debits Maya's deposit liability and credits Alex's; the total liability stays the same.",
    failure:"If the transaction aborts after the sender debit attempt, neither posting is visible. A transfer with only one side committed is a ledger defect, not an in-progress transfer.",
    rule:"Inside one bank, debit and credit are one database commit.",source:"transactions"
  },
  {
    name:"Handle a double tap",title:"The same request cannot move $120 twice.",
    lead:"Maya taps Send again when the response is slow. Bank A finds K1 and returns T1's existing result. It does not post a second debit or a second Alex credit.",
    focus:["Maya's app","Bank A service","Bank A ledger"],signal:"K1 → T1 once",
    from:"Second POST /transfers",to:"Bank A transfer service",message:"request_key=K1; same sender, recipient, and 12000 cents.",
    state:"One intent has one T1 and one balanced ledger pair.",
    why:"Mobile networks drop responses; people retry. The bank must separate a retry from a new payment.",
    build:"Make (sender_id, request_key) unique. Store a fingerprint of recipient and amount. Same key plus same details returns T1; same key plus changed details fails.",
    inside:"The unique key protects a local operation. The ACH file later needs a separate submission identity and trace number so a replayed file is not treated as a new payment.",
    failure:"A random new key on each retry defeats the guarantee. Keep K1 stable in the client until T1 reaches a known result.",
    rule:"A repeated request returns its first transfer, not a second debit.",source:"transactions"
  },
  {
    name:"Change Alex's bank",title:"The first route stops at the bank boundary.",
    lead:"Replay the same hypothetical $120 transfer, now with Alex at Bank B. Bank A cannot write Bank B's customer ledger. It needs a payment instruction through a shared rail: a U.S. ACH credit via FedACH.",
    focus:["Maya's app","Bank A service","Bank A ledger"],signal:"Bank A → ACH → Bank B",
    from:"Maya's transfer request",to:"Bank A outbound ACH route",message:"Alex's Bank B routing number and account number; $120 credit.",
    state:"T1 must cross institutions. The same-bank posting is no longer the route.",
    why:"A database transaction in Bank A cannot atomically update a separate bank's database.",
    build:"Classify on-us versus external destinations. Choose ACH credit for this example. Keep T1 and K1, but give external transfers distinct sent, settled, and returned states.",
    inside:"ACH credit is a push: the sender's side originates an entry instructing the receiving bank to credit Alex. ODFI means originating bank; RDFI means receiving bank.",
    failure:"Treating an external transfer like an internal ledger credit would show Alex paid without any instruction reaching Bank B.",
    rule:"A cross-bank transfer needs both a payment instruction and interbank settlement.",source:"ach"
  },
  {
    name:"Check the destination",title:"Validate what Bank A can know before sending.",
    lead:"Maya confirms Alex's routing number, account number, and $120. Bank A checks input shape, the routing destination, transfer limits, available funds, and fraud signals before it accepts T1.",
    focus:["Maya's app","Bank A service"],signal:"Recipient + amount confirmed",
    from:"Maya's saved recipient",to:"Bank A validation and risk checks",message:"routing number; account number; account type if needed; recipient name; $120.",
    state:"A syntactically valid destination is ready for the Bank A funding step.",
    why:"A mistyped or replaced account number can send funds to the wrong place. Checks are most useful before the entry leaves Bank A.",
    build:"Verify routing-number syntax and reachability, protect stored account details, require confirmation for changed recipients, enforce limits, and queue suspicious requests for review. Show a masked account suffix to Maya.",
    inside:"A valid routing number does not prove the account exists or belongs to Alex. An RDFI may post by account number even when the name differs; do not advertise name matching as a guarantee.",
    failure:"If risk review holds T1, do not debit and send it as though approved. Show REVIEW rather than SENT, with a clear next action.",
    rule:"Input checks reduce mistakes; Bank B still decides whether the account can be credited.",source:"name"
  },
  {
    name:"Fund the transfer",title:"Bank A removes $120 from Maya once.",
    lead:"Bank A debits Maya's deposit by $120 and credits an outbound ACH payable by $120 in one local ledger transaction. T1 becomes READY_TO_SEND. Alex has not received anything yet.",
    focus:["Bank A service","Bank A ledger"],signal:"Maya deposit → ACH payable",
    from:"Approved T1",to:"Bank A ledger",message:"Dr Maya deposit liability $120; Cr outbound ACH payable $120.",
    state:"Maya sees $120 taken; Bank A owes that amount into the ACH settlement flow.",
    why:"This teaching design funds the ACH credit before sending, so Bank A will not promise money Maya can spend again.",
    build:"Use one short transaction: guard available balance ≥12000, post two balanced ledger entries, mark T1 READY_TO_SEND, and commit. Keep a unique ledger posting key for T1.",
    inside:"The payable is an internal accounting account, not Alex's account. Different banks may hold or post the customer's debit at a different point; this example chooses an immediate debit.",
    failure:"If Maya has only $80 available, reject T1 before any entry is sent. Do not create a negative balance unless an explicit overdraft product allows it.",
    rule:"The sender debit is local; the recipient credit comes later at Bank B.",source:"transactions"
  },
  {
    name:"Queue the instruction",title:"A committed debit gets a durable path to ACH.",
    lead:"The same Bank A transaction that funds T1 writes outbox event ACHCreditRequested(T1). An ACH worker reads that row and prepares an entry for the next file window.",
    focus:["Bank A service","Bank A ledger","ACH worker"],signal:"T1 + outbox in one commit",
    from:"Bank A ledger transaction",to:"ACH worker",message:"event_id=E1; transfer_id=T1; type=ACHCreditRequested.",
    state:"A crash after Bank A debits Maya cannot silently lose the instruction.",
    why:"Writing the ledger and then calling a separate file service can fail between the two actions.",
    build:"Insert T1's outbox row in the funding transaction. The worker claims unsent events, creates one entry per T1, and records delivery attempts. Give T1 a unique outbound entry mapping.",
    inside:"The worker can see E1 twice after a crash. It must find T1's existing ACH entry instead of making a second one.",
    failure:"If the worker stops, T1 stays READY_TO_SEND and outbox age grows. Alert and restart it; do not silently label the transfer SENT.",
    rule:"A posted sender debit needs a durable unsent instruction.",source:"outbox"
  },
  {
    name:"Build the ACH entry",title:"Put T1 into a file with a trace number.",
    lead:"The worker creates a Nacha-format credit entry for Bank B: routing ID, Alex's account, $120, recipient name, and an ODFI-assigned trace number. A batch and file wrap the entry with counts and totals.",
    focus:["ACH worker","Bank A ledger"],signal:"T1 → ACH entry + trace",
    from:"ACHCreditRequested(T1)",to:"Outbound ACH file F1",message:"Bank B routing; Alex account; amount=0000012000; trace=TR1; batch/file totals.",
    state:"F1 contains one durable instruction; no file has been accepted by FedACH yet.",
    why:"The operator processes a defined file format, not a free-form app request.",
    build:"Generate file header, batch header, entry detail, batch control, and file control records. Assign a unique trace number within the ODFI's batch/file rules; persist T1→F1→TR1 before transmission. Validate totals and format.",
    inside:"The ACH entry detail uses cents without a decimal point. The actual 15-digit trace number and routing/account fields follow Nacha's fixed-width layout; TR1 is only a teaching label.",
    failure:"A malformed record or wrong control total can reject a file or batch. Keep the exact bytes and validation result so the operator response can be matched to F1.",
    rule:"The trace identifies the entry; the file totals guard the batch.",source:"format"
  },
  {
    name:"Send to FedACH",title:"File acceptance is the first external checkpoint.",
    lead:"Bank A transmits F1 through its FedACH connection. FedACH acknowledges file or batch status. If accepted, Bank A records FILE_ACCEPTED; it still cannot say Alex was credited.",
    focus:["ACH worker","FedACH","Bank A ledger"],signal:"F1 accepted or rejected",
    from:"Bank A ACH worker",to:"FedACH",message:"F1 bytes; file ID; batch count and total; operator acknowledgment.",
    state:"The operator has accepted a payment instruction for processing.",
    why:"Without an external acceptance result, Bank A cannot know whether the file entered the network.",
    build:"Use the bank's authorized FedACH channel, store sent-at and operator responses, handle file and batch rejects, and move T1 only when its containing entry was accepted. Preserve F1 identity for inquiries.",
    inside:"A transport connection or upload success is weaker than an operator acceptance. An accepted file is weaker than settlement and recipient posting.",
    failure:"If F1, its batch, or TR1 is rejected, repair the reason and submit a corrected attempt under controlled operations. Keep T1 linked to every attempt; never treat two as successful.",
    rule:"Accepted by FedACH means accepted for processing, not paid to Alex.",source:"receipt"
  },
  {
    name:"Route to Bank B",title:"FedACH sorts the entry by receiving bank.",
    lead:"FedACH edits and sorts F1's entries, then sends Alex's credit entry to Bank B. Bank B sees routing, account, amount, and trace data in an incoming ACH file.",
    focus:["FedACH","Bank B","ACH worker"],signal:"TR1 delivered to Bank B",
    from:"FedACH sorted output",to:"Bank B incoming ACH processing",message:"TR1; Alex account; credit $120; settlement date.",
    state:"Bank B has the instruction. Alex's balance may still be unchanged.",
    why:"The operator must deliver each entry to the bank that owns the receiving account.",
    build:"At Bank B, ingest the operator's file once, validate the entry, keep its trace and settlement date, and detect duplicates. At Bank A, track operator distribution evidence when available.",
    inside:"There are two U.S. ACH operators. This example chooses the Federal Reserve's FedACH service; Nacha writes network rules but is not the operator carrying F1.",
    failure:"If Bank B misses an expected output file, reconcile its operator file list before posting from a stale copy or assuming no credit exists.",
    rule:"Operator delivery is a bank-to-bank instruction, not a recipient notification.",source:"fedach"
  },
  {
    name:"Settle between banks",title:"The banks' Federal Reserve accounts change.",
    lead:"On the ACH settlement date, the operator nets the batch activity and debits Bank A's settlement position while crediting Bank B's. In Bank A's books, the $120 outbound payable is cleared against its reserve asset.",
    focus:["FedACH","Bank A ledger","Bank B"],signal:"Bank A −$120; Bank B +$120",
    from:"FedACH settlement process",to:"Banks' settlement accounts",message:"Net ACH positions; Bank A pays $120 toward Bank B in this one-entry example.",
    state:"Interbank settlement occurred. Alex's customer credit is a separate Bank B posting.",
    why:"An instruction alone does not pay the receiving bank. Settlement transfers value between the banks.",
    build:"Match the operator settlement summary to F1/TR1, post Dr outbound payable and Cr reserves at Bank A, and reconcile the Federal Reserve account statement. In this example Bank B posts Dr reserves and Cr incoming ACH payable until it can credit Alex.",
    inside:"FedACH settles banks' net obligations, not a separate reserve transfer visible for every single customer entry. This one-entry example shows the net as $120. Real files contain many credits and debits.",
    failure:"If the settlement summary and internal payable differ, stop automatic closeout and investigate missing, rejected, or duplicated entries before adjusting any ledger.",
    rule:"Interbank settlement and customer-account posting are different events.",source:"fedach"
  },
  {
    name:"Credit Alex",title:"Bank B posts the $120 to Alex's account.",
    lead:"Bank B checks that Alex's account can receive the credit. It posts a $120 credit to Alex's deposit account and records TR1 as processed. Alex's balance rises at Bank B.",
    focus:["Bank B","Alex at Bank B"],signal:"Alex +$120 at Bank B",
    from:"Bank B incoming entry TR1",to:"Alex's Bank B ledger",message:"Dr incoming ACH payable $120; Cr Alex deposit liability $120.",
    state:"Alex's customer account has been credited in this example.",
    why:"The receiving bank is the only party that can write Alex's account balance.",
    build:"Validate the destination account status, dedupe TR1 with origin data, post the customer credit and processed marker atomically, then expose it in Alex's transaction history.",
    inside:"Bank B may choose an order of posting and settlement that differs from this example, subject to funds-availability rules. If it cannot post, it prepares an ACH return rather than inventing an Alex credit.",
    failure:"If the account is closed or nonexistent, keep the entry in exception processing and return it with the applicable reason; do not credit a nearby or guessed account.",
    rule:"Bank B, not FedACH or Bank A, credits Alex's deposit account.",source:"ach"
  },
  {
    name:"Make funds available",title:"Alex can use the credit when Bank B releases it.",
    lead:"Bank B makes the posted ACH credit available under the applicable ACH timing rules and tells Alex. Bank A can show Maya that T1 was sent and settled, but it has no universal per-entry success message proving Bank B posted it.",
    focus:["Bank B","Alex at Bank B","Maya's app","Bank A service"],signal:"Available to Alex; settled to Maya",
    from:"Bank B posting + settlement status",to:"Alex and Maya's account views",message:"Alex: $120 available. Maya: T1 sent/settled; return monitoring continues.",
    state:"The recipient can spend the credit in the happy path; Bank A's displayed claim stays within its evidence.",
    why:"Posted, available, and confirmed to the sender are different facts.",
    build:"Track settlement date separately from Bank B's posting and availability. Use explicit statuses such as SENT, SETTLED, RETURNED. Show 'recipient credited' to Maya only with recipient-bank confirmation or other direct evidence.",
    inside:"For ordinary ACH credits, availability generally follows the settlement-date rules. Some banks offer early availability from their own funds before settlement. Same Day ACH uses different windows.",
    failure:"Do not mark T1 'delivered to Alex' merely because FedACH accepted F1 or a return has not yet arrived.",
    rule:"A status label must say exactly what the bank knows.",source:"availability"
  },
  {
    name:"Handle a return",title:"A wrong account can send the $120 back.",
    lead:"Replay a failure: Alex's account number is wrong, so Bank B cannot post the credit. It sends an ACH return referencing TR1 with a reason such as R03. The return settles back to Bank A, which credits Maya under its return policy.",
    focus:["Bank B","FedACH","ACH worker","Bank A ledger","Maya's app"],signal:"TR1 → return R03",
    from:"Bank B rejected recipient account",to:"FedACH → Bank A returns",message:"original trace TR1; return reason R03; amount $120.",
    state:"T1 becomes RETURNED. Maya receives a matching compensating credit; Alex was not paid.",
    why:"Some destination errors are only visible to the receiving bank after the original entry was sent.",
    build:"Ingest return files, match original trace plus amount and bank details to T1, dedupe the return, and post one compensating ledger entry after return settlement. Show the reason and ask Maya to verify new details.",
    inside:"A return is a new ACH entry in the other direction, with its own settlement. It is not deletion of the original debit or settlement history.",
    failure:"If Bank A credits Maya twice for the same return, it creates money in the customer ledger. Use the return identity and original T1 as unique posting keys.",
    rule:"A return is a separate payment event that compensates the original.",source:"returns"
  },
  {
    name:"Correct an error",title:"A sent transfer cannot be silently edited.",
    lead:"If Maya notices a wrong destination after F1 was accepted, Bank A investigates. Before submission it may cancel the queued instruction. After submission, a permitted ACH reversal or a request for return may be possible, but neither guarantees the money comes back.",
    focus:["Maya's app","Bank A service","ACH worker","FedACH","Bank B"],signal:"Cancel before send; investigate after",
    from:"Maya's correction request",to:"Bank A payment operations",message:"T1 status; file F1; trace TR1; actual error; recovery case.",
    state:"The original T1 stays in the audit trail while a recovery action is tracked separately.",
    why:"Changing a database field after sending F1 would not change the file Bank B already received.",
    build:"Allow cancellation only with a guarded transition while the worker has not claimed the unsent entry; atomically mark T1 canceled and reverse Maya's debit and the outbound payable. After acceptance or an uncertain send, open a case, check reversal eligibility and time limit, or request return through the banks. A corrected payment gets a new T2 and K2.",
    inside:"Nacha limits reversals to defined sender errors and timing; a reversal is not a universal undo button. A fraudulently induced transfer is not automatically eligible for a reversal.",
    failure:"Never re-send T1 to a new account while the first transfer's outcome is unknown. That can pay two recipients.",
    rule:"Before send, cancel; after send, resolve with a separate traceable action.",source:"reversal"
  },
  {
    name:"Recover a lost reply",title:"A transmission timeout is not a failed file.",
    lead:"Bank A's connection drops just after it sends F1. The worker cannot tell whether FedACH accepted it. It keeps F1 in UNKNOWN, checks operator file status and acknowledgments, and only then decides whether a controlled resend is needed.",
    focus:["ACH worker","FedACH","Bank A ledger"],signal:"F1 status = UNKNOWN",
    from:"Timed-out file transmission",to:"FedACH status inquiry",message:"F1 identity; send time; operator receipt/acceptance or rejection.",
    state:"Maya's $120 remains funded, and no second ACH entry is invented.",
    why:"Blindly generating F2 after a timeout can duplicate the payment if F1 was already accepted.",
    build:"Persist exact F1 bytes, file identifiers, checksums, and attempt times. Query FedACH file status and reconcile acknowledgments; keep an operations queue for unresolved submissions. Resend only under a defined duplicate-control procedure.",
    inside:"T1's app idempotency key does not protect the ACH operator from a second independently generated file. The bank owns file-level duplicate controls.",
    failure:"A missing acknowledgment is not proof of rejection. Escalate UNKNOWN rather than declaring T1 failed and refunding Maya while F1 may settle.",
    rule:"Unknown external acceptance stays unknown until matched to operator evidence.",source:"api"
  },
  {
    name:"Reconcile every boundary",title:"Close the gap between local and network records.",
    lead:"Bank A compares T1, its ledger debit and payable, the outbox, F1 and TR1, FedACH acceptance, settlement summary, and any return. Bank B compares received entries with its customer postings and exception queue.",
    focus:["Bank A ledger","ACH worker","FedACH","Bank B"],signal:"T1 ↔ F1 ↔ TR1 ↔ settlement",
    from:"Bank and operator records",to:"Daily reconciliation + exception queue",message:"counts; amounts; trace IDs; statuses; settlement date; unresolved differences.",
    state:"Missing, duplicated, or stuck transfers become named exceptions with owners and next actions.",
    why:"The system crosses databases, files, and institutions. No one transaction can commit them all.",
    build:"Balance debit totals with outbound entries, accepted batches with settlement summaries, and returns with compensating postings. Alert on old READY_TO_SEND, UNKNOWN, and SETTLED-with-return-mismatch states.",
    inside:"Use independent evidence rather than trusting one status field. Keep original records immutable and post corrections as new entries.",
    failure:"A silent one-cent difference across a large file can hide a lost or duplicated entry. Compare both counts and amounts, then drill down by trace.",
    rule:"Every external boundary needs a matching record and an exception path.",source:"api"
  },
  {
    name:"Choose a faster rail",title:"The same intent can use a different network.",
    lead:"For a later transfer, Bank A may offer FedNow when both banks participate. It sends one instant payment message and receives a final network result in seconds. Maya's balance guard and retry key still matter, but ACH batches, file returns, and timing rules no longer describe that route.",
    focus:["Maya's app","Bank A service","Bank A ledger","FedACH","Bank B","Alex at Bank B"],signal:"ACH path versus FedNow path",
    from:"New transfer intent",to:"Rail selection at Bank A",message:"Choose available rail before sending; persist the chosen rail and its IDs.",
    state:"The product can offer different speed and finality with an explicit route choice.",
    why:"'Bank transfer' is a user action, not one universal network. Rails have different messages, schedules, and recovery rules.",
    build:"Determine participation, availability, limits, cost, and required speed before committing a route. Keep a separate adapter and state machine per rail. Never retry a settled ACH credit as a new FedNow payment.",
    inside:"FedNow is 24/7 instant interbank settlement for participants. Fedwire and RTP have their own finality and operating rules. This guide's concrete trace remains a standard FedACH credit.",
    failure:"A fallback after an uncertain ACH submission can pay Alex twice. Rail switching is safe only before sending or after the first outcome is resolved.",
    rule:"Choose the rail before transmission; never use a faster rail as a blind retry.",source:"fednow"
  }
];
