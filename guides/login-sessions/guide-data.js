// One account and one browser, replayed as the login system grows.
const sources = {
  password:["OWASP: password storage","https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html"],
  auth:["OWASP: authentication and login throttling","https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html"],
  authorization:["OWASP: authorization controls","https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html"],
  cookie:["MDN: Set-Cookie and __Host- rules","https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie"],
  session:["OWASP: session management","https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html"],
  postgres:["PostgreSQL: database transactions","https://www.postgresql.org/docs/current/tutorial-transactions.html"],
  csrf:["OWASP: CSRF prevention","https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html"],
  xss:["OWASP: cross-site scripting prevention","https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html"],
  reset:["OWASP: forgot password flow","https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html"],
  webauthn:["W3C: Web Authentication Level 3","https://www.w3.org/TR/webauthn-3/"],
  redis:["Redis: key expiration","https://redis.io/docs/latest/commands/expire/"]
};

const participants = [
  {name:"Asha's browser",detail:"form, cookies, and page requests",added:0},
  {name:"App server A",detail:"login and request middleware",added:0},
  {name:"App database",detail:"users, password hashes, and notes",added:0},
  {name:"Server memory",detail:"first version: local session map",added:3,removed:8},
  {name:"App server B",detail:"second copy of the app",added:7},
  {name:"PostgreSQL sessions",detail:"shared, revocable session records",added:8},
  {name:"Email service",detail:"password reset delivery",added:13},
  {name:"Authenticator",detail:"passkey or second factor",added:15},
  {name:"Redis cache",detail:"optional hot session lookups",added:16}
];

const layers = [
  {name:"First route",until:8,items:[
    {at:0,label:"Password hash"},{at:1,label:"Login request"},{at:2,label:"Verify"},{at:3,label:"Cookie + memory"},
    {at:4,label:"Later request"},{at:5,label:"Resource check"},{at:6,label:"Logout"},{at:7,label:"Second-server gap"}
  ]},
  {name:"Shared session",items:[
    {at:8,label:"PostgreSQL store"},{at:9,label:"Idle + absolute expiry"},{at:10,label:"Remember device"}
  ]},
  {name:"Protect actions",items:[
    {at:11,label:"CSRF check"},{at:12,label:"XSS and TLS"},{at:13,label:"Reset password"},{at:14,label:"Device revoke"}
  ]},
  {name:"Grow",items:[
    {at:15,label:"Passkey"},{at:16,label:"Redis cache"},{at:17,label:"Audit and recovery"}
  ]}
];

const steps = [
  {
    name:"Create Asha's account",title:"Store a password verifier, not the password.",
    lead:"Asha creates an account for a notes app. The server stores user U1 and an Argon2id password hash with its salt and cost settings. A later login can check the password without reading it back from storage.",
    focus:["Asha's browser","App server A","App database"],signal:"U1 + Argon2id hash",
    from:"Asha's sign-up form",to:"App database",message:"email; password → Argon2id encoded hash; user_id=U1.",
    state:"The account exists. Asha is not signed in by this record alone.",
    why:"Login needs a stored way to verify a secret. Plaintext or fast SHA-256 password storage makes a database leak far more damaging.",
    build:"Use a well-maintained Argon2id library, a fresh salt per password, and a unique user ID. Store the encoded hash; keep passwords out of logs. Confirm ownership of the email before using it for recovery.",
    inside:"Argon2id deliberately costs memory and time per guess. Its encoded hash carries the salt and cost parameters so the verifier can use them later.",
    failure:"A duplicate email should not silently create a second U1. Handle the database uniqueness result and avoid leaking account existence through public responses.",
    rule:"The users table holds a verifier, never a readable password.",source:"password"
  },
  {
    name:"Send a login request",title:"The browser submits Asha's proof over HTTPS.",
    lead:"Asha enters her email and password. Her browser sends POST /login over HTTPS. The app server receives the credentials for this one request; the browser does not store them as a session token.",
    focus:["Asha's browser","App server A"],signal:"POST /login",
    from:"Asha's login form",to:"App server A",message:"email + password in HTTPS request body.",
    state:"Account U1 may be found, but no login has succeeded yet.",
    why:"The server must check the password before it can create an authenticated session.",
    build:"Use a POST form or same-origin API call, require HTTPS, set no-store on sensitive responses, and avoid putting passwords in URLs, analytics, or error logs.",
    inside:"TLS protects the request in transit. It does not replace password hashing in storage or session checks on later requests.",
    failure:"Reject HTTP downgrade and malformed input before credential verification. Do not echo a password in a validation error.",
    rule:"A login form submits a proof; it does not grant access by itself.",source:"auth"
  },
  {
    name:"Verify and slow guessing",title:"One correct password passes; guesses are limited.",
    lead:"The server finds U1 by normalized email and asks the Argon2id library to verify the submitted password against U1's stored hash. On success it proceeds; on failure it shows the same generic error used for an unknown email.",
    focus:["App server A","App database"],signal:"Argon2id verify → yes or no",
    from:"POST /login",to:"App database + password verifier",message:"normalized email → U1 hash; candidate password → verify result.",
    state:"Asha is authenticated for this login attempt, but later requests still need a session.",
    why:"A correct password proves control now; rate controls make repeated automated guesses costly.",
    build:"Use library verification, apply rate limits and risk checks across account and network signals, and return one public failure message. Record failed attempts without storing candidate passwords.",
    inside:"A generic error prevents a direct 'this email exists' leak. Throttling must avoid letting an attacker permanently lock someone else out.",
    failure:"If the password is wrong or the attempt is throttled, issue no session cookie. Keep the response timing and wording reasonably uniform.",
    rule:"Password verification grants one authentication event, not a standing browser identity.",source:"auth"
  },
  {
    name:"Issue the first session",title:"Give Asha's browser an opaque handle.",
    lead:"Server A generates 32 random bytes for session S1, stores S1→U1 in its memory with an expiry, and replies with a Secure, HttpOnly, SameSite=Lax cookie. The browser keeps the opaque value; it cannot decode U1 from it.",
    focus:["App server A","Server memory","Asha's browser"],signal:"Set-Cookie: __Host-session=S1",
    from:"Successful password check",to:"Server memory + browser cookie jar",message:"S1 → U1, expires_at; __Host-session=S1; Path=/; Secure; HttpOnly; SameSite=Lax.",
    state:"Asha is signed in on server A for a bounded time.",
    why:"A password should not be sent on every page load. A random session handle lets the server remember the login.",
    build:"Use a cryptographic random generator, create a fresh ID after login, set an eight-hour server expiry in this example, and send Max-Age=28800. The __Host- cookie has Path=/ and no Domain attribute.",
    inside:"The cookie value is a bearer secret: anyone with it can act as Asha until it expires or is revoked. HttpOnly stops normal page JavaScript from reading it, not an attacker from using a stolen copy.",
    failure:"Do not keep or reuse a pre-login session ID after authentication. Rotate it so a planted or known ID cannot become Asha's logged-in session.",
    rule:"A new random session ID links the browser to a server-side login record.",source:"cookie"
  },
  {
    name:"Open a protected page",title:"The browser sends the cookie automatically.",
    lead:"Asha opens /notes two minutes later. The browser includes Cookie: __Host-session=S1. Server A finds S1 in memory, checks its expiry, gets U1, and loads U1's notes. A page reload works the same way.",
    focus:["Asha's browser","App server A","Server memory"],signal:"Cookie S1 → user U1",
    from:"GET /notes with Cookie S1",to:"Session lookup on server A",message:"S1 → U1; valid expiry → load U1 notes.",
    state:"The password is not resubmitted. The session proves who is making this request.",
    why:"HTTP requests do not remember who sent a prior request; the cookie connects them.",
    build:"Put session lookup in middleware before protected routes. Reject missing, unknown, revoked, or expired IDs with 401 or a login redirect. Cache the loaded user only for the current request.",
    inside:"The browser decides when to attach cookies based on domain, path, Secure, SameSite, and expiry attributes. The server still makes the authentication decision on every request.",
    failure:"If S1 is missing or expired, do not render private notes from a previous page's client cache as if Asha were still authenticated.",
    rule:"Every protected request checks the session again.",source:"session"
  },
  {
    name:"Check the actual note",title:"Signed in does not mean access to every record.",
    lead:"Asha requests /notes/42. The session says she is U1. The note query must also require owner_id=U1. If note 42 belongs to Ben, the app denies it even though S1 is valid.",
    focus:["Asha's browser","App server A","App database"],signal:"note.owner_id must equal U1",
    from:"GET /notes/42",to:"Notes query with U1",message:"session user U1; note_id=42; require owner_id=U1.",
    state:"A valid login reaches only data U1 is allowed to see.",
    why:"Authentication answers 'who is this?'; authorization answers 'may this user read this note?'.",
    build:"Use the session-derived U1 in the database filter or centralized policy check. Never accept a user_id parameter from the browser as proof of ownership.",
    inside:"Guessable IDs are fine only if the server checks permission for each object. A valid cookie does not make every URL safe.",
    failure:"If an attacker changes /notes/42 to /notes/43, the query must return no unauthorized data or side effect.",
    rule:"Check permissions on the requested object after checking the session.",source:"authorization"
  },
  {
    name:"Log out",title:"Delete the server record, then clear the cookie.",
    lead:"Asha clicks Log out. Server A removes S1 from its session map and sends an expired __Host-session cookie with the same Path and host scope. The next request with a copied S1 fails.",
    focus:["Asha's browser","App server A","Server memory"],signal:"S1 revoked",
    from:"POST /logout",to:"Session map + browser cookie jar",message:"delete S1; Set-Cookie: __Host-session=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax.",
    state:"Future requests cannot use S1. An already running request may finish.",
    why:"Clearing a browser cookie alone leaves a stolen S1 valid on the server.",
    build:"Invalidate S1 server-side, clear the cookie using the same attributes, and make logout a state-changing POST. Treat a repeated logout as success without reviving anything.",
    inside:"The browser's Back button can display a cached page. Set Cache-Control: no-store on private responses, but rely on server checks for actual data and actions.",
    failure:"If server revocation fails, do not tell Asha all devices were signed out. Retry or surface a real failure; do not rely on cookie deletion alone.",
    rule:"Logout is a server-side revocation, not just a browser UI change.",source:"session"
  },
  {
    name:"Add server B",title:"The memory-only version breaks across replicas.",
    lead:"Traffic grows and server B joins. Asha's next /notes request lands on B, which has no S1 in its memory. A restart of A has the same effect: Asha is asked to log in again despite a valid-looking cookie.",
    focus:["Asha's browser","App server A","App server B","Server memory"],signal:"S1 known on A, unknown on B",
    from:"Browser Cookie S1",to:"App server B",message:"B looks for S1 in its own map → no row.",
    state:"The first route cannot keep logins working across app copies or restarts.",
    why:"Process memory belongs to one server and disappears when that process stops.",
    build:"Reproduce the failure with two app instances behind a load balancer. Do not make sticky routing the only fix; move active sessions to a shared store.",
    inside:"A load balancer can keep a browser on A for a while, but deployment, failover, or routing changes still expose the missing shared session.",
    failure:"Treating every B miss as a bad password misleads Asha. The cookie did not fail; the session state was never shared.",
    rule:"All app replicas need the same session truth.",source:"session"
  },
  {
    name:"Move sessions to PostgreSQL",title:"Both servers read one revocable session table.",
    lead:"Replay the login with a shared store. Server A creates fresh S2, stores SHA-256(S2) with U1 and expiry in PostgreSQL, and sets S2 in the cookie. Server B hashes S2 and finds the same row on the next request.",
    focus:["Asha's browser","App server A","App server B","PostgreSQL sessions"],signal:"SHA-256(S2) → U1",
    from:"Successful login on A",to:"Shared PostgreSQL sessions",message:"token_hash=SHA-256(S2); user_id=U1; created_at; expires_at; revoked_at=NULL.",
    state:"Asha stays signed in across requests to A or B and through app restarts.",
    why:"The cookie is only a lookup handle; the shared row is the session truth.",
    build:"Create sessions(token_hash primary key, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at, revoked_at). Generate 32 random bytes per login; store only the hash, and index user_id for device revocation.",
    inside:"SHA-256 is suitable for a uniformly random 256-bit token. It is not suitable for human passwords, which need slow Argon2id hashing. A leaked session table cannot directly reveal the raw cookie values.",
    failure:"If PostgreSQL is unavailable, fail closed for protected requests. Do not accept an unsigned client claim of U1 to keep the page working.",
    rule:"The browser holds a secret; PostgreSQL holds its hash and revocation state.",source:"session"
  },
  {
    name:"Bound the lifetime",title:"The server decides when S2 stops working.",
    lead:"The app gives S2 a 30-minute idle limit and an eight-hour absolute limit for this example notes app. Activity may extend the idle deadline, never the absolute deadline. At either limit, both servers reject S2.",
    focus:["Asha's browser","App server A","App server B","PostgreSQL sessions"],signal:"idle ≤ 30 min; absolute ≤ 8 h",
    from:"Each request with S2",to:"Shared session row",message:"now < idle_expires_at AND now < absolute_expires_at AND revoked_at IS NULL.",
    state:"Reloads within the active window work; a stale cookie eventually loses access.",
    why:"A cookie can outlive the security decision. A stolen ID should not work forever.",
    build:"Check both deadlines on every authenticated request using server time. Extend idle_expires_at after activity, with a write throttle if needed; never move absolute_expires_at. Clear the cookie after rejection.",
    inside:"Max-Age controls how long the browser keeps the cookie. The database limits can end the session sooner. Timeout values are product and risk choices, not universal constants.",
    failure:"A browser countdown or changing a cookie expiry must not revive a session whose server row expired or was revoked.",
    rule:"Cookie lifetime is a browser hint; server-side expiry is the authority.",source:"session"
  },
  {
    name:"Remember this device",title:"A longer login uses a separate rotating credential.",
    lead:"If Asha opts in, the app stores a second random token R1 for this device, with a 30-day absolute limit. After S2 expires, a same-origin refresh request uses R1 once to create S3 and replace R1 with R2. Without opt-in, Asha signs in again.",
    focus:["Asha's browser","App server A","PostgreSQL sessions"],signal:"R1 → S3 + R2",
    from:"POST /session/refresh with remember cookie R1",to:"Shared device-token and session tables",message:"hash(R1) active → consume R1; create S3; store hash(R2); set both new cookies.",
    state:"The browser can return after the short session ends, until the device credential expires or is revoked.",
    why:"A very long-lived access session would leave a stolen session ID useful for too long.",
    build:"Use a separate Secure, HttpOnly, __Host-remember cookie, stored hashed per device. Atomically consume R1 and issue R2; cap the device's absolute lifetime. Protect refresh with a same-origin request policy and coordinate tabs to avoid two refreshes racing.",
    inside:"A reused old R1 can signal theft, but simultaneous tabs can also race. Use one refresh request at a time and a narrow, deliberate concurrency policy before treating reuse as compromise.",
    failure:"Do not extend the 30-day absolute limit on every rotation. If R1 is revoked or expired, require a fresh login instead of silently making R3.",
    rule:"Long-lived recognition is a separate, revocable device credential.",source:"session"
  },
  {
    name:"Protect write requests",title:"A valid cookie can be sent without Asha's intent.",
    lead:"A malicious page tries to make Asha's browser POST /notes/42/delete. Her browser may attach the session cookie automatically. The notes app rejects the request unless a session-bound CSRF token and trusted origin checks pass.",
    focus:["Asha's browser","App server A","PostgreSQL sessions"],signal:"Cookie alone cannot authorize POST",
    from:"Cross-site or same-site forged POST",to:"App server A write endpoint",message:"Cookie S3; Origin header; X-CSRF-Token → validate before changing note 42.",
    state:"The forged request fails even if the browser sent a valid cookie.",
    why:"Cookies are automatic browser credentials. A website can try to use that behavior to make unwanted changes.",
    build:"Keep GET routes read-only. For authenticated writes, validate Origin against the exact site and a random CSRF token bound to S3, sent in a form field or custom header. Protect pre-login and refresh endpoints with their own same-origin checks. SameSite=Lax adds another layer.",
    inside:"The CSRF token is distinct from the session cookie. Reading a cookie back from the request and calling it a CSRF check proves nothing: the browser sent it automatically.",
    failure:"Reject an untrusted or missing Origin in this same-origin app. If a real client needs an Origin-less path, design and test an explicit token-only fallback. Never put CSRF tokens in URLs or logs.",
    rule:"A cookie proves a session; a write also needs an allowed request origin or intent token.",source:"csrf"
  },
  {
    name:"Limit script and token theft",title:"HttpOnly helps, but unsafe page code can still act as Asha.",
    lead:"A note containing attacker-controlled HTML is rendered on Asha's page. If it runs as script, it can call the same-origin API with Asha's cookie even though HttpOnly hides S3 from document.cookie. The app renders note text safely.",
    focus:["Asha's browser","App server A"],signal:"Treat note text as data",
    from:"Stored note content",to:"Asha's browser renderer",message:"untrusted text → escaped output or safe DOM text; no executable markup.",
    state:"A note cannot run code that spends Asha's authenticated session.",
    why:"Cookie flags reduce exposure, but an XSS bug can make requests from inside the signed-in page.",
    build:"Use framework escaping or textContent for untrusted text, sanitize only when rich HTML is required, set a restrictive Content Security Policy, keep HTTPS, and avoid logging session or remember tokens.",
    inside:"Secure keeps cookies on HTTPS requests; HttpOnly hides them from page JavaScript; SameSite limits some cross-site sends. None of those flags makes unsafe HTML safe.",
    failure:"An attacker script may modify or delete notes without ever reading the cookie value. Test the actual browser behavior, not just whether document.cookie is empty.",
    rule:"Protect the page that carries the session, not just the cookie bytes.",source:"xss"
  },
  {
    name:"Reset a forgotten password",title:"Recovery proves control through a separate channel.",
    lead:"Asha forgets her password. The app shows the same message whether her email exists. For U1 it sends a short-lived, single-use reset link with random token P1. When Asha uses P1, the app replaces the Argon2id hash and revokes her old sessions and remember tokens.",
    focus:["Asha's browser","App server A","App database","PostgreSQL sessions","Email service"],signal:"P1 used once; old logins revoked",
    from:"POST /password-reset-request",to:"Email link + reset endpoint",message:"random P1; store hash(P1); expiry; used_at; U1; new Argon2id hash.",
    state:"Asha can set a new password; an old stolen session does not remain valid.",
    why:"Recovery is another way into the account. It needs its own proof and must close old access after a compromise.",
    build:"Generate P1 with a cryptographic RNG, store only its hash, expire it quickly, consume it atomically once, hash the new password, and revoke active sessions and device tokens. Do not automatically sign Asha in from the reset link.",
    inside:"An email link proves control of that mailbox at use time, subject to mailbox security. The reset token must not appear in server logs or third-party analytics.",
    failure:"If P1 is used twice or after expiry, reject it. A generic request response prevents an attacker from listing which emails have accounts.",
    rule:"Password reset is a one-time credential change plus session cleanup.",source:"reset"
  },
  {
    name:"Show signed-in devices",title:"Asha can revoke one device without losing every session.",
    lead:"Asha signs in on her laptop and phone. Each login has a separate session row and, if opted in, a separate remember-token family. The account screen lists approximate device and last-use details; Asha revokes the phone.",
    focus:["Asha's browser","App server A","PostgreSQL sessions"],signal:"Revoke phone session family",
    from:"Asha's device list",to:"PostgreSQL sessions + device tokens",message:"user=U1; device=phone; set revoked_at; revoke its remember family.",
    state:"Future phone requests fail; the laptop can stay signed in.",
    why:"A lost device should be removable without changing the password or guessing which raw token it holds.",
    build:"Give each login a device record, name it only with safe approximate metadata, require recent authentication for remote revocation, and revoke both its short session and long-lived credential. Provide a revoke-all action.",
    inside:"IP address and user-agent are clues, not reliable identity. An in-flight request may finish after revocation, so sensitive writes should recheck current authorization near commit.",
    failure:"Revoking only S3 leaves R2 able to create S4. Always revoke the matching remember-token family too.",
    rule:"One device has its own revocable access path.",source:"session"
  },
  {
    name:"Add a passkey",title:"A stronger proof can create the same kind of session.",
    lead:"Asha registers a passkey. On a later login, the server sends a fresh challenge; her authenticator signs it. The server verifies the signature, challenge, origin, and site ID against U1's stored public key, then issues a new session like S2.",
    focus:["Asha's browser","App server A","App database","Authenticator","PostgreSQL sessions"],signal:"WebAuthn proof → new session",
    from:"Server challenge via browser",to:"Authenticator → server verification",message:"credential ID; signed challenge; origin; RP ID; public-key verification.",
    state:"Asha is authenticated without sending a password on this login; later requests still use a session cookie.",
    why:"A passkey resists password guessing and is scoped to the site's identity. It changes the login proof, not the need to manage a session.",
    build:"Use a proven WebAuthn library. Store credential ID and public key, generate a new challenge per attempt, verify the expected origin and RP ID, then create a fresh session. Protect credential enrollment and recovery.",
    inside:"The authenticator keeps the private key. The server stores a public key; a copied public key cannot sign the next challenge.",
    failure:"A replayed challenge, wrong origin, or wrong RP ID must fail. Do not treat a passkey success from another site as U1's login.",
    rule:"Different login proofs can lead to the same bounded session model.",source:"webauthn"
  },
  {
    name:"Cache session lookups",title:"Redis helps reads only after correctness is clear.",
    lead:"At high traffic, each page may read PostgreSQL for S2. The app adds Redis as a short-lived cache keyed by token hash. A miss checks PostgreSQL; logout deletes the shared row and cached copy.",
    focus:["App server A","App server B","PostgreSQL sessions","Redis cache"],signal:"Redis hit or PostgreSQL lookup",
    from:"Cookie S2 on a protected request",to:"Redis cache → PostgreSQL on miss",message:"SHA-256(S2) → user U1, expiry, revocation version; cache TTL short.",
    state:"The two app servers can reduce database reads. A cached read may lag revocation for at most its configured TTL unless it rechecks PostgreSQL.",
    why:"A shared database lookup on every request can become a bottleneck after the app grows.",
    build:"Cache only bounded session metadata, cap cache TTL by the server-side deadline, invalidate on logout/revoke, and recheck PostgreSQL for high-risk actions. Measure hit rate, lookup latency, and stale-revocation risk.",
    inside:"A cached S2 can briefly outlive a DB revocation if invalidation is delayed. Short TTL and explicit invalidation limit that window; stronger actions use the authoritative row.",
    failure:"If Redis is down, fall back to PostgreSQL. If PostgreSQL is down, reject protected operations rather than accepting an unverified cookie forever.",
    rule:"A cache may speed session reads; revocation still needs one authority.",source:"redis"
  },
  {
    name:"Watch and recover",title:"Make failures visible without exposing secrets.",
    lead:"The app records login successes, failed attempts, new devices, password resets, remote revocations, and unusual refresh-token reuse. It can alert Asha and operators while keeping passwords, raw session IDs, CSRF tokens, and reset links out of logs.",
    focus:["App server A","App server B","App database","PostgreSQL sessions","Redis cache"],signal:"Audit IDs, not secret bytes",
    from:"Auth events across the system",to:"Audit log and account notices",message:"user U1; event type; time; approximate device; outcome; session record ID only.",
    state:"Asha can review access; operators can find stuck or suspicious states.",
    why:"Security controls need evidence to show whether they worked and to support account recovery.",
    build:"Track failed-login rates, session creation/revocation, expired rows, refresh retries, reset use, Redis invalidation lag, and unauthorized note requests. Separate audit IDs from bearer tokens and apply retention/access controls.",
    inside:"A log of raw bearer tokens becomes another credential store. A suspicious event is a signal to investigate, not automatic proof of theft.",
    failure:"If reset revocation or cache invalidation fails, keep the account in a safe state and retry with a durable task; do not quietly leave old device credentials valid.",
    rule:"Observe the login state machine without logging the keys that open it.",source:"session"
  }
];
