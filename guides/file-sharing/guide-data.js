const sources = {
  file: ["MDN: browser File API", "https://developer.mozilla.org/en-US/docs/Web/API/File_API"],
  validation: ["OWASP: file upload checks", "https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html"],
  consistency: ["AWS: S3 object consistency", "https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html"],
  copy: ["AWS: copy a specified version", "https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html"],
  token: ["W3C: capability URL design", "https://www.w3.org/TR/capability-urls/"],
  disposition: ["MDN: Content-Disposition", "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Disposition"],
  policy: ["AWS: signed POST policy", "https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-HTTPPOSTConstructPolicy.html"],
  cors: ["AWS: S3 browser CORS", "https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html"],
  version: ["AWS: S3 version IDs", "https://docs.aws.amazon.com/AmazonS3/latest/userguide/AddingObjectstoVersioningEnabledBuckets.html"],
  head: ["AWS: HeadObject metadata", "https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html"],
  signed: ["AWS: signed URL access and expiry", "https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html"],
  multipart: ["AWS: multipart upload", "https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html"]
};
const participants = [
  {name:"Maya's browser",detail:"Chooses and uploads",added:0},
  {name:"App API",detail:"Authorizes and links",added:1},
  {name:"PostgreSQL",detail:"Tracks file and share states",added:2},
  {name:"Private S3",detail:"Stores staging and final bytes",added:2},
  {name:"File checker",detail:"Inspects untrusted bytes",added:3},
  {name:"Leo's browser",detail:"Redeems and downloads",added:6}
];
const layers = [
  {name:"FIRST ROUTE",items:[{at:0,label:"File chosen"},{at:1,label:"API upload"},{at:2,label:"Private staging"},{at:3,label:"Check"},{at:4,label:"READY"},{at:5,label:"Share token"},{at:6,label:"Link check"},{at:7,label:"App stream"}]},
  {name:"DIRECT ROUTE",items:[{at:8,label:"Signed POST"},{at:9,label:"Browser → S3"},{at:10,label:"Version-pinned finish"}]},
  {name:"DOWNLOAD",items:[{at:11,label:"Signed GET"},{at:12,label:"Revoke or expire"}]},
  {name:"RECOVER",items:[{at:13,label:"Retry + cleanup"},{at:14,label:"Multipart"}]}
];
const steps = [
  {
    name:"Choose the PDF",title:"Maya picks a file; the server has nothing yet.",
    lead:"Maya selects report.pdf, a 4 MiB PDF. The browser exposes a File with a name, size, and type, and the UI can show a preview of what she chose.",
    focus:["Maya's browser"],signal:"Local File selected",
    from:"Maya",to:"Browser File API",message:"name=report.pdf; size=4 MiB; type=application/pdf (browser-provided).",
    state:"Only Maya's browser has the bytes.",
    why:"The app needs a clear file choice and a size warning before sending any bytes.",
    build:"Use a file input. Show the name and size, and let Maya remove or replace the choice before upload.",
    inside:"File.name and File.type come from the client. The type may be empty or wrong; they cannot establish that the bytes are safe.",
    failure:"A browser refresh loses an unsent File reference. Maya must select it again unless the app has another local persistence feature.",
    rule:"A selected file is local, and its metadata is untrusted.",source:"file"
  },
  {
    name:"Start with one API",title:"The first version sends bytes through the app server.",
    lead:"Maya signs in and sends POST /files with multipart/form-data. The app checks her identity, quota, and a 10 MiB limit while it streams the body.",
    focus:["Maya's browser","App API"],signal:"POST /files",
    from:"Maya's browser",to:"App API",message:"Authenticated upload request carrying report.pdf bytes.",
    state:"The app is receiving bytes; no share link exists.",
    why:"One API endpoint is a small, understandable starting point for an upload system.",
    build:"Authenticate the request, limit body size and rate, and stream bytes instead of holding the whole file in server memory.",
    inside:"The browser's filename is displayed only after sanitization. The server chooses the storage key; it never uses report.pdf as a trusted path.",
    failure:"If the connection drops halfway, reject or discard the incomplete stream. Do not mark a partial file READY.",
    rule:"An upload request is not a published file.",source:"validation"
  },
  {
    name:"Store and track",title:"Keep bytes and metadata in different places.",
    lead:"The app creates file_id=f-41 with state PENDING in PostgreSQL, then streams bytes to a private S3 staging key such as staging/u-41. When S3 accepts them, the row becomes STAGED.",
    focus:["App API","PostgreSQL","Private S3"],signal:"PENDING → STAGED",
    from:"App API",to:"PostgreSQL + private S3",message:"file_id=f-41; owner=Maya; expected_size=4 MiB; staged_key=staging/u-41.",
    state:"The bytes exist privately. No one can download them through a share link.",
    why:"S3 holds file bytes; PostgreSQL holds owner, state, keys, and later access rules.",
    build:"Create the PENDING row before the S3 write. Update to STAGED only after S3 confirms success. Keep the bucket private.",
    inside:"S3 and PostgreSQL do not share one transaction. If one succeeds and the other fails, a later cleanup or reconciliation job must resolve the mismatch.",
    failure:"A DB row may outlive a failed upload, or an S3 object may outlive a failed DB update. Neither should become shareable.",
    rule:"Storage success and application readiness are separate facts.",source:"consistency"
  },
  {
    name:"Inspect the bytes",title:"Treat the uploaded PDF as untrusted.",
    lead:"A checker reads the staged object, verifies the actual size and file signature, and runs the chosen malware and PDF checks. The file moves to CHECKING while this happens.",
    focus:["Private S3","File checker","PostgreSQL"],signal:"STAGED → CHECKING",
    from:"Private S3 staging",to:"File checker",message:"The exact staged object bytes for f-41; claimed PDF name and type are only hints.",
    state:"Still private. A failed check leads to REJECTED.",
    why:"A .pdf name and application/pdf header can be spoofed. A public link must wait for checks.",
    build:"Allow only needed file types, inspect the content signature, scan it, and limit parser work. For PDFs, consider content disarm if the product requires it.",
    inside:"A signature check alone or one malware scanner is not a guarantee. The policy chooses what this product accepts; rejected files never reach READY.",
    failure:"If the checker times out, leave the file in CHECKING for retry or mark it failed after a limit. Do not silently publish it.",
    rule:"The check reads bytes; it does not trust the uploaded filename or MIME header.",source:"validation"
  },
  {
    name:"Publish the checked copy",title:"The shared object becomes fixed and private.",
    lead:"After the checks pass, the server copies the checked bytes to a new key, files/f-41, that only its server role can write. It marks the database row READY after the copy succeeds.",
    focus:["File checker","Private S3","PostgreSQL"],signal:"CHECKING → READY",
    from:"Private S3 staging",to:"Private S3 final key + PostgreSQL",message:"Copy checked object to files/f-41; record final_key; set status=READY.",
    state:"The file is ready, but no share link has been created.",
    why:"The final key gives the share flow one stable object and isolates it from any later staging upload.",
    build:"Generate a unique final key, copy the checked source, then conditionally update CHECKING to READY. Keep final-prefix writes server-only.",
    inside:"If the copy succeeds but the DB update fails, the final object is an orphan to reconcile. Marking READY before the copy would create a broken link.",
    failure:"A duplicate worker must not publish two different final keys. Use a state transition guard and reconcile orphan objects.",
    rule:"Copy first, mark READY second, share third.",source:"copy"
  },
  {
    name:"Create a share link",title:"The link names a permission, not an S3 key.",
    lead:"Maya asks to share f-41. The app creates a long random token, stores its hash with file_id and expiry, and returns a link such as /s/<token>.",
    focus:["Maya's browser","App API","PostgreSQL"],signal:"Share ACTIVE",
    from:"Maya's browser",to:"App API + shares table",message:"POST /files/f-41/shares → /s/<random-token>.",
    state:"Anyone who holds this link can ask for the file until it expires or Maya revokes it.",
    why:"The app can check a stable share record on every new request and later revoke it without renaming the S3 object.",
    build:"Generate at least 128 random bits for the token, store only its hash, bind it to f-41, and record expiry and owner.",
    inside:"The raw link is a bearer secret. Do not use sequential IDs. Keep it out of logs, analytics, and referrer headers sent to other sites.",
    failure:"If a link leaks, anyone with it can redeem it while active. Maya must be able to revoke it.",
    rule:"The share URL is an access capability, not the storage location.",source:"token"
  },
  {
    name:"Redeem the link",title:"Leo reaches the app before he reaches the bytes.",
    lead:"Leo opens /s/<token>. The app hashes the token, finds an ACTIVE, unexpired share, and checks that f-41 is still READY.",
    focus:["Leo's browser","App API","PostgreSQL"],signal:"Share check passes",
    from:"Leo's browser",to:"App API + PostgreSQL",message:"GET /s/<token>; token hash lookup; share ACTIVE; file READY.",
    state:"Leo is allowed to start this download request.",
    why:"A private bucket cannot know the app's share rules by itself. The app makes that decision.",
    build:"Return the same simple unavailable page for missing, expired, revoked, or not-ready links. Rate-limit redemption attempts.",
    inside:"This worked example is 'anyone with the link.' An invite-only product would also authenticate Leo and check his account.",
    failure:"A valid token with a file still CHECKING must not leak the staging object.",
    rule:"A valid share token only works while the file is READY and the share is active.",source:"token"
  },
  {
    name:"Serve through the app",title:"The first download path streams the private object.",
    lead:"The app reads files/f-41 from S3 and streams the PDF to Leo with a safe filename and Content-Disposition: attachment.",
    focus:["App API","Private S3","Leo's browser"],signal:"App streams bytes",
    from:"Private S3 → App API",to:"Leo's browser",message:"PDF bytes; Content-Type: application/pdf; Content-Disposition: attachment.",
    state:"Leo can save the file. Maya's app server carries every download byte.",
    why:"Streaming through the app keeps the share check close to the file response and is easy to reason about.",
    build:"Stream rather than buffer. Send a safe Content-Disposition filename and avoid rendering untrusted files on the app's own origin.",
    inside:"A client can stop downloading after the authorization check. A download count must define whether it means request started or full transfer completed.",
    failure:"If the app process dies mid-stream, Leo's download fails and he can retry while the link is active.",
    rule:"A successful link check starts delivery; it does not prove Leo saved the whole file.",source:"disposition"
  },
  {
    name:"Move upload bytes off the API",title:"Direct upload removes the app server from the byte path.",
    lead:"Now replay Maya's upload with a larger audience. Her browser computes SHA-256; the app checks identity and quota, creates PENDING file f-41, and returns a short-lived S3 signed POST policy for staging/u-41.",
    focus:["Maya's browser","App API","PostgreSQL","Private S3"],signal:"Signed POST for one staging key",
    from:"Maya's browser → App API",to:"S3 POST policy",message:"POST /uploads with size and SHA-256 → upload_id=u-41, S3 form URL and signed fields.",
    state:"Maya may upload only under the policy's key, size range, and expiry. No file is READY yet.",
    why:"S3 can receive the bytes directly, so app servers do not need capacity proportional to upload traffic.",
    build:"Sign an exact staging key, content-length-range, and expected checksum field. Return form fields, not AWS credentials. Keep the staging bucket private.",
    inside:"The SHA-256 form value is base64-encoded digest bytes. A signed POST is temporary upload permission, not a one-time token; it can be reused until expiry.",
    failure:"An expired policy or over-limit body fails at S3. The PENDING row remains for retry or cleanup.",
    rule:"The API grants a narrow upload permission; it no longer carries file bytes.",source:"policy"
  },
  {
    name:"Upload straight to S3",title:"The browser sends the form to private staging.",
    lead:"Maya's browser POSTs the file and signed fields to S3. S3 returns success and a version ID, v-7, for the write to staging/u-41.",
    focus:["Maya's browser","Private S3"],signal:"S3 version v-7 stored",
    from:"Maya's browser",to:"S3 staging endpoint",message:"Signed multipart/form-data POST; exact key=staging/u-41; PDF bytes + SHA-256 field.",
    state:"Version v-7 exists in staging. The app still has not called it READY.",
    why:"The browser can upload without seeing storage credentials or passing bytes through the app API.",
    build:"Configure S3 CORS for the app's origin and POST. Expose x-amz-version-id so the browser can send that exact version to the app during finalization. S3 checks the submitted checksum.",
    inside:"Browser progress reports bytes sent, not that S3 accepted or the app published them. A second POST to the same key creates another version in a versioned bucket.",
    failure:"If CORS blocks the response, the bytes may still have arrived. Reconcile with the upload session before assuming failure.",
    rule:"S3 acceptance creates staged bytes, not a shareable file.",source:"cors"
  },
  {
    name:"Finish one exact version",title:"The app checks what S3 actually stored.",
    lead:"Maya calls POST /uploads/u-41/complete with version v-7. The API returns CHECKING. A worker checks that version's size and checksum, scans its bytes, copies it to files/f-41, and marks READY.",
    focus:["Maya's browser","App API","Private S3","File checker","PostgreSQL"],signal:"v-7 checked → READY",
    from:"Maya's browser → App API",to:"S3 version v-7 + file checker",message:"upload_id=u-41; version_id=v-7; expected size=4 MiB; checked source → final key.",
    state:"The direct route reaches the same READY state as the first route.",
    why:"Pinning one S3 version prevents a later reuse of the POST policy from changing which bytes are scanned or copied.",
    build:"Validate that u-41 belongs to Maya and maps to staging/u-41. Return CHECKING, then read metadata and content by version ID, compare size and expected checksum, scan, copy, and update the row.",
    inside:"HEAD checks metadata without downloading bytes. It cannot prove a PDF is safe; the checker must read the pinned version. Do not treat S3 ETag as a universal full-file checksum.",
    failure:"If v-7 is absent, wrong-sized, or fails a checksum or content check, leave the file unavailable and give Maya a clear retry path.",
    rule:"The object you verify must be the exact object you publish.",source:"head"
  },
  {
    name:"Offload the download",title:"Keep the share check; let S3 send the bytes.",
    lead:"When Leo's /s/<token> request passes, the app creates a short-lived signed GET for files/f-41 and redirects his browser to S3. S3 sends the PDF directly.",
    focus:["Leo's browser","App API","PostgreSQL","Private S3"],signal:"302 → short-lived signed GET",
    from:"App API",to:"Leo's browser → private S3",message:"302 Location: temporary signed GET for files/f-41; attachment filename.",
    state:"The app handles access rules; S3 handles download traffic.",
    why:"Large or popular downloads no longer consume app-server bandwidth after the access check.",
    build:"Sign GET only after checking the share and READY file. Set a short expiry and safe download response metadata, then redirect.",
    inside:"The signed GET itself is a bearer URL. It can be reused until expiry, even if Maya revokes the stable share link after it was issued.",
    failure:"If the GET expires before Leo starts or retries a broken transfer, he returns to the stable share link for a fresh check and URL.",
    rule:"The stable share link and temporary S3 URL are different permissions.",source:"signed"
  },
  {
    name:"Revoke or expire",title:"Maya can stop new redemptions.",
    lead:"Maya revokes the share or its expiry passes. The app rejects later /s/<token> requests while the private file can remain in storage for her account.",
    focus:["Maya's browser","App API","PostgreSQL","Leo's browser"],signal:"Share REVOKED or EXPIRED",
    from:"Maya's browser",to:"Shares table",message:"Set revoked_at for this share, or compare expires_at with server time.",
    state:"New share checks fail. A previously issued signed GET may work until its own expiry.",
    why:"Link access has a lifecycle separate from file retention.",
    build:"Check revoked_at and expires_at on each redemption. Keep signed GET lifetime short; use app streaming if every byte request requires a fresh app check.",
    inside:"Revocation cannot remove a copy Leo already downloaded. Deleting the file is a separate owner action with its own cleanup path.",
    failure:"A long-lived signed GET creates a long revocation window. A cached or saved copy cannot be clawed back.",
    rule:"Revoking a share stops future app approvals, not past downloads.",source:"signed"
  },
  {
    name:"Recover and clean up",title:"Every partial state needs an owner and a timeout.",
    lead:"Uploads can stop after the DB row, after S3 storage, or after the final copy. A reconciliation job finds stale rows and orphan objects without ever exposing them.",
    focus:["App API","PostgreSQL","Private S3"],signal:"Reconcile partial work",
    from:"Scheduled worker",to:"PostgreSQL + S3",message:"Find old PENDING/STAGED/CHECKING rows, abandoned versions, and unreferenced final keys.",
    state:"Retries can resume safely; unused storage is eventually removed.",
    why:"PostgreSQL and S3 cannot commit together. A cleanup process closes the gaps left by crashes.",
    build:"Give each upload_id a stable owner and status. Make complete idempotent for the same pinned version. Reconcile DB records with S3 objects and delete old staging versions by lifecycle policy.",
    inside:"A reusable signed POST can create several staging versions. Do not delete the pinned version while a checker is using it; use retention windows and explicit state.",
    failure:"If cleanup runs too early, it can remove a slow but valid upload. If it never runs, abandoned versions and parts keep costing storage.",
    rule:"A failed upload must become retryable or cleanly expired.",source:"version"
  },
  {
    name:"Handle large files",title:"Replace one upload request with retriable parts.",
    lead:"For a much larger file, the app starts an S3 multipart upload. The browser uploads numbered parts, retries only failed parts, and the app completes the upload before checking and publishing its version.",
    focus:["Maya's browser","App API","Private S3","PostgreSQL","File checker"],signal:"Parts → completed object",
    from:"Maya's browser",to:"S3 multipart upload",message:"upload_id, part numbers, part ETags/checksums; CompleteMultipartUpload → version ID.",
    state:"The completed object enters the same STAGED → CHECKING → READY pipeline.",
    why:"One broken connection need not restart an entire large upload.",
    build:"Initiate multipart server-side, issue narrow part permissions, record each successful part, verify the list, complete once, then pin the completed version for checks. Abort abandoned uploads.",
    inside:"S3 assembles parts only on CompleteMultipartUpload. Multipart ETag is not a full-file MD5. A single CopyObject works only up to 5 GB; larger final copies need multipart copy.",
    failure:"Uncompleted parts remain stored and billed until aborted or a lifecycle rule removes them. Retrying complete must reconcile whether S3 already assembled the object.",
    rule:"Large-file transport changes; validation, READY, and share rules stay the same.",source:"multipart"
  }
];
