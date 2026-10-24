const sources = {
  websocket: ["MDN: WebSocket API", "https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API"],
  constraints: ["PostgreSQL: unique constraints", "https://www.postgresql.org/docs/current/ddl-constraints.html"],
  locking: ["PostgreSQL: row locks", "https://www.postgresql.org/docs/current/explicit-locking.html"],
  push: ["Firebase: message lifetime", "https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-lifespan"],
  pushorder: ["Firebase: message order and collapse", "https://firebase.google.com/docs/cloud-messaging/customize-messages/collapsible-message-types"],
  outbox: ["Debezium: outbox event router", "https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html"],
  kafka: ["Apache Kafka: partition ordering", "https://kafka.apache.org/documentation/"]
};
const participants = [
  {name:"Asha's device", detail:"Creates and retries", added:0},
  {name:"App gateway", detail:"Holds live sockets", added:1},
  {name:"Auth + members", detail:"Checks permission", added:3},
  {name:"PostgreSQL", detail:"Owns saved messages", added:4},
  {name:"Ravi's device", detail:"Receives and syncs", added:6},
  {name:"Push service", detail:"Optional wake hint", added:9},
  {name:"Outbox + Kafka", detail:"Optional scale path", added:12}
];
const layers = [
  {name:"SEND",items:[{at:0,label:"Local draft"},{at:1,label:"WSS"},{at:2,label:"Message envelope"},{at:3,label:"Permission check"}]},
  {name:"SAVE",items:[{at:4,label:"DB commit"},{at:5,label:"Server ACK"},{at:11,label:"Safe retry"}]},
  {name:"RECEIVE",items:[{at:6,label:"Live route"},{at:7,label:"Delivery ACK"},{at:8,label:"Read event"}]},
  {name:"RECOVER + GROW",items:[{at:9,label:"Push hint"},{at:10,label:"Cursor sync"},{at:12,label:"Outbox → Kafka"}]}
];
const steps = [
  {
    name:"Write locally",title:"Asha writes a message. Nothing has left her device.",
    lead:"Asha types “On my way” in conversation c-42. The app creates client_message_id=asha-73 and shows a pending bubble.",
    focus:["Asha's device"],signal:"Local draft → pending",
    from:"Asha",to:"Asha's app",message:"body='On my way'; conversation_id=c-42; client_message_id=asha-73.",
    state:"Pending on Asha's device. Ravi knows nothing about it.",
    why:"A local ID lets the app recognize this same send if it must retry.",
    build:"Store the draft and its stable client ID locally until the server confirms it. Keep the same ID across retry.",
    inside:"The local timestamp can help the UI, but it cannot determine the final order of messages sent by different devices.",
    failure:"If the app closes now, a locally saved draft can be retried. If it was never saved locally, it may be lost.",
    rule:"A bubble on the sender's screen is not proof the server has it.",source:"constraints"
  },
  {
    name:"Open a live channel",title:"The app connects to the server.",
    lead:"Asha's app opens a WSS connection. The server can now receive sends and push new events back over the same connection.",
    focus:["Asha's device","App gateway"],signal:"WSS connection open",
    from:"Asha's app",to:"App gateway",message:"Secure WebSocket connection and an authenticated session.",
    state:"A channel exists; no message is saved yet.",
    why:"A live two-way channel avoids a new request for every incoming message.",
    build:"Use a WebSocket server over TLS. Authenticate the connection and bind it to Asha's user identity.",
    inside:"WebSocket carries frames, not chat semantics. The application defines send, ACK, message, and receipt events.",
    failure:"A closed socket can interrupt a send. Reconnect and reconcile against the server before deciding it failed.",
    rule:"A network connection is a route, not durable storage.",source:"websocket"
  },
  {
    name:"Submit the envelope",title:"Asha sends one application event.",
    lead:"Her app sends SEND with conversation c-42, client ID asha-73, and the message body. It does not choose the server message ID or sequence.",
    focus:["Asha's device","App gateway"],signal:"SEND(c-42, asha-73)",
    from:"Asha's device",to:"App gateway",message:"type=SEND; conversation_id=c-42; client_message_id=asha-73; body='On my way'.",
    state:"The gateway received bytes; the message is still pending.",
    why:"The envelope names the target conversation and gives retries a stable identity.",
    build:"Define a small versioned event format and reject malformed or oversized payloads.",
    inside:"The connection's authenticated identity supplies sender_id. A sender_id field inside the event would be untrusted.",
    failure:"If the socket drops before a reply, Asha cannot tell whether the server saved the event. Step 12 resolves that ambiguity.",
    rule:"Receiving SEND is not the same as accepting the message.",source:"websocket"
  },
  {
    name:"Check permission",title:"The server checks who may write to c-42.",
    lead:"The gateway knows this socket belongs to Asha. It checks that Asha is an active member of c-42 and that the message passes size and rate rules.",
    focus:["App gateway","Auth + members"],signal:"Asha may send to c-42",
    from:"App gateway",to:"Membership data + validation",message:"authenticated user=Asha; conversation_id=c-42; payload length and send rate.",
    state:"Allowed to try saving, or rejected with an explicit error.",
    why:"Knowing who opened a socket is not enough; each conversation has its own access rule.",
    build:"Bind the socket to a session, validate every SEND, and recheck membership in the save transaction if removal can race a send.",
    inside:"A rejected event never gets a server message ID. Return an error tied to client_message_id so Asha can mark that bubble failed.",
    failure:"Trusting a client-provided sender ID or conversation membership lets one user send as another or into a private chat.",
    rule:"Authorize the action, not just the connection.",source:"constraints"
  },
  {
    name:"Commit the message",title:"PostgreSQL gives the message its lasting identity.",
    lead:"In one transaction, lock c-42's row, check for an earlier asha-73, assign seq=18, insert m-918, and commit. Only then may the server call it saved.",
    focus:["Auth + members","PostgreSQL"],signal:"m-918 committed at seq 18",
    from:"App gateway",to:"PostgreSQL",message:"conversation=c-42; sender=Asha; client_id=asha-73; body; next sequence.",
    state:"Message m-918 is durable in this design. Ravi may still be offline.",
    why:"The database keeps the message when a socket, server process, or device disappears.",
    build:"Use conversations.next_seq under a row lock; insert messages with unique (conversation_id, seq) and unique (sender_id, client_message_id). Commit before delivery work.",
    inside:"Locking the conversation row serializes concurrent sends to that conversation. Check the idempotency key while holding that lock; otherwise a retry can race the first send.",
    failure:"If the transaction rolls back, neither the message nor its sequence update survives. The sender stays pending and may retry.",
    rule:"The database commit is the line between pending and saved.",source:"locking"
  },
  {
    name:"Confirm the sender",title:"Asha gets the server's answer.",
    lead:"The server replies ACK with client_message_id=asha-73, message_id=m-918, and seq=18. Her app changes the pending bubble to sent.",
    focus:["PostgreSQL","App gateway","Asha's device"],signal:"Server ACK after commit",
    from:"App gateway",to:"Asha's device",message:"type=ACK; client_message_id=asha-73; message_id=m-918; seq=18.",
    state:"Asha sees sent. Ravi has not necessarily received it.",
    why:"The client ID connects a local pending bubble to the committed server record.",
    build:"Send the ACK only after commit. Store the returned server ID and sequence beside the local bubble.",
    inside:"A server ACK is an application promise about its database. WebSocket's send() return or a TCP acknowledgment is not that promise.",
    failure:"The commit can succeed while the ACK is lost. Asha retries with asha-73 and gets the original result.",
    rule:"Sent means accepted by the server, not delivered to Ravi.",source:"websocket"
  },
  {
    name:"Route to Ravi",title:"An online device gets the saved message.",
    lead:"Ravi has a live WSS connection. The server sends m-918 with c-42 and seq=18 to that device. It can send the same record to Ravi's other connected devices.",
    focus:["PostgreSQL","App gateway","Ravi's device"],signal:"MESSAGE(m-918, seq 18)",
    from:"App gateway",to:"Ravi's connected device",message:"type=MESSAGE; message_id=m-918; conversation_id=c-42; seq=18; body.",
    state:"The server attempted live delivery. Delivery is not yet confirmed.",
    why:"A live socket makes a fresh message appear quickly while the database remains the record to recover from.",
    build:"Keep a connection map for one server. Send committed messages to recipient devices; do not treat a successful socket write as device delivery.",
    inside:"Presence is only a hint: a connected socket can die just as the server writes. The device must still acknowledge and sync on reconnect.",
    failure:"A socket write can fail or reach a device that closes before saving. The message remains in PostgreSQL for catch-up.",
    rule:"Live fanout is a fast path, not proof of receipt.",source:"websocket"
  },
  {
    name:"Confirm delivery",title:"Ravi's device reports that it stored the message.",
    lead:"The device stores m-918 locally and sends DELIVERY_ACK for that message. The server records a receipt and can tell Asha that at least one Ravi device received it.",
    focus:["Ravi's device","App gateway","PostgreSQL"],signal:"Delivered on Ravi device",
    from:"Ravi's device",to:"App gateway + receipt store",message:"type=DELIVERY_ACK; message_id=m-918; device_id=ravi-phone.",
    state:"Delivered by this guide's rule; Ravi may not have opened the chat.",
    why:"An explicit device report is stronger than an attempted WebSocket send.",
    build:"Dedupe by message_id on the device. Save first, then ACK. Store receipts by message and device if multi-device detail matters.",
    inside:"The server can derive a user-level delivered state when the first recipient device ACK arrives. A second device can ACK later without creating another message.",
    failure:"If the delivery ACK is lost, Ravi already has the message but Asha may still see sent. Repeated ACKs should be harmless.",
    rule:"Delivered means a device acknowledged under the product's chosen rule.",source:"constraints"
  },
  {
    name:"Report a read",title:"Reading is a separate event.",
    lead:"When Ravi opens c-42 and the app shows through seq=18, it may send READ_UP_TO(c-42,18). The server records that cursor and can notify Asha.",
    focus:["Ravi's device","App gateway","PostgreSQL"],signal:"Read through seq 18",
    from:"Ravi's device",to:"App gateway + receipt store",message:"type=READ_UP_TO; conversation_id=c-42; seq=18.",
    state:"Asha may see read; the app cannot prove Ravi understood the text.",
    why:"Receiving a message in the background and viewing its conversation are different events.",
    build:"Send a read event only when the product's visibility rule is met. Make receipts optional if privacy settings require it.",
    inside:"A read cursor can cover several messages. Validate that it belongs to Ravi and cannot advance beyond the messages he is allowed to see.",
    failure:"If the read event is lost, the receipt can be resent. The saved message and delivery state remain intact.",
    rule:"Read is an explicit app report, never inferred from delivery.",source:"websocket"
  },
  {
    name:"Handle offline",title:"What if Ravi has no live socket?",
    lead:"Rewind to just after the database commit. If Ravi is offline instead, m-918 stays in PostgreSQL. The app may ask Firebase Cloud Messaging to wake his phone so it can sync.",
    focus:["PostgreSQL","Push service","Ravi's device"],signal:"Optional push hint",
    from:"App backend",to:"FCM → Ravi's device",message:"A content-free hint such as 'new messages in c-42'; no canonical message body required.",
    state:"The push request was accepted or rejected; it does not prove Ravi received m-918.",
    why:"Mobile apps may not have a live socket in the background. A push hint can prompt a later sync.",
    build:"Treat FCM as an optional wake mechanism. The app fetches actual messages from your server on open or wake.",
    inside:"FCM can delay, replace, expire, or discard messages and does not guarantee order. A collapsible hint is useful because the database holds the actual chat history.",
    failure:"If FCM never reaches the phone, m-918 is still waiting in PostgreSQL. The next app open runs catch-up.",
    rule:"Push is a notification path, not the source of truth.",source:"pushorder"
  },
  {
    name:"Catch up",title:"Ravi asks for what his device missed.",
    lead:"On reconnect, Ravi's phone sends its last contiguous saved sequence for c-42: 17. The server returns messages with seq greater than 17, ordered by seq.",
    focus:["Ravi's device","App gateway","PostgreSQL"],signal:"SYNC after seq 17",
    from:"Ravi's device",to:"App gateway → PostgreSQL",message:"SYNC(conversation=c-42, after_seq=17) → m-918 at seq=18.",
    state:"Ravi stores m-918, moves its device cursor to 18, and sends a delivery ACK.",
    why:"A reconnect query repairs gaps left by a dead socket or missing push.",
    build:"Store a cursor per device and conversation. Query messages by (conversation_id, seq), page large gaps, dedupe by message_id, and advance only through contiguous saved sequences.",
    inside:"If live delivery and sync return m-918 together, the device keeps one copy. A phone and laptop have separate cursors because each can be offline independently.",
    failure:"Advancing a cursor past a missing sequence can permanently hide the gap. Retention or deletion needs an explicit tombstone or skip rule.",
    rule:"Reconnect always checks the database, even if push was received.",source:"constraints"
  },
  {
    name:"Retry safely",title:"Unknown outcomes must not create duplicate messages.",
    lead:"Now take another branch: Asha never got the ACK for asha-73. She resends the same envelope. The server finds the existing row and returns m-918, seq=18 instead of inserting another message.",
    focus:["Asha's device","App gateway","PostgreSQL"],signal:"Same client ID → same message",
    from:"Asha's retry",to:"PostgreSQL",message:"SEND(c-42, asha-73) again; lookup unique (sender_id, client_message_id).",
    state:"One committed message, one server sequence, one bubble on each device.",
    why:"Networks can lose replies after the server has already done the work.",
    build:"Keep the client ID stable; lock the conversation row, check for that ID, then allocate a sequence only if absent. Validate a retry's conversation and body match the first request.",
    inside:"Sequence order comes from the server's serialized commits, not device clocks. A second distinct send gets a new client ID and a later sequence.",
    failure:"Generating a fresh client ID for each retry defeats deduplication. Reusing one ID with different content should be rejected.",
    rule:"A retry repeats an attempt; it does not create a new message.",source:"locking"
  },
  {
    name:"Scale the route",title:"Add a reliable event path when one server is no longer enough.",
    lead:"With many gateways, Ravi may be connected elsewhere. Insert an outbox event with m-918 in the same PostgreSQL transaction, then publish it to Kafka keyed by c-42.",
    focus:["PostgreSQL","App gateway","Outbox + Kafka","Ravi's device"],signal:"Committed event → Kafka partition",
    from:"PostgreSQL outbox",to:"Kafka → gateway or delivery worker",message:"event_id=e-918; conversation_id=c-42; message_id=m-918; seq=18.",
    state:"Other workers can route the event; device ACK and sync rules stay the same.",
    why:"A database commit followed by a separate direct publish can fail between the two actions. The outbox keeps both records in one transaction.",
    build:"Write message and outbox row together. Relay committed outbox rows with Debezium or a polling worker. Key Kafka events by conversation, dedupe event_id, and locate Ravi's current gateway.",
    inside:"Kafka preserves order within a partition, but cross-partition order is not promised. The database seq remains the chat order. A connection directory may be held in a shared store such as Redis; stale entries must be tolerated.",
    failure:"An outbox event may be delivered twice or after Ravi reconnects. Consumers dedupe, and devices still fetch gaps from PostgreSQL.",
    rule:"Kafka distributes committed events; it does not replace chat storage or device ACKs.",source:"outbox"
  }
];
