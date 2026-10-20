const sources = {
  url: ["MDN: how the web works", "https://developer.mozilla.org/en-US/docs/Learn_web_development/Getting_started/Web_standards/How_the_web_works"],
  cache: ["MDN: HTTP caching", "https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching"],
  dns: ["Cloudflare: DNS resolution", "https://developers.cloudflare.com/learning-paths/cybersafe/concepts/what-is-dns/"],
  pages: ["Cloudflare: Pages asset serving", "https://developers.cloudflare.com/pages/configuration/serving-pages/"],
  http3: ["IETF: HTTP/3", "https://www.rfc-editor.org/rfc/rfc9114.html"],
  browser: ["MDN: how browsers load pages", "https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work"],
  http: ["MDN: HTTP messages", "https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Messages"],
  bfcache: ["web.dev: back/forward cache", "https://web.dev/articles/bfcache"]
};
const participants = [
  { name: "Browser", detail: "Starts navigation", added: 0 },
  { name: "Local cache", detail: "May answer locally", added: 1 },
  { name: "DNS resolver", detail: "Finds an address", added: 2 },
  { name: "DNS authority", detail: "Holds DNS records", added: 2 },
  { name: "Cloudflare edge", detail: "Receives the request", added: 3 },
  { name: "Pages assets", detail: "Stores deployed files", added: 7 },
  { name: "HTML parser", detail: "Builds the document", added: 9 },
  { name: "Renderer", detail: "Draws the page", added: 10 }
];
const layers = [
  { name: "ADDRESS", items: [{at:0,label:"URL"},{at:2,label:"DNS answer"},{at:3,label:"Edge IP"}] },
  { name: "CONNECTION", items: [{at:4,label:"TCP or QUIC"},{at:5,label:"TLS + certificate"}] },
  { name: "TRANSFER", items: [{at:6,label:"GET /"},{at:7,label:"Pages asset"},{at:8,label:"HTML response"}] },
  { name: "BROWSER", items: [{at:9,label:"DOM + CSS"},{at:10,label:"Layout + paint"},{at:11,label:"Interaction"}] }
];
const steps = [
  {
    name:"Read the URL", title:"The browser turns an address into a plan.",
    lead:"Open https://systems-from-zero.pages.dev/. The browser separates the scheme, host, and path before it asks for anything.",
    focus:["Browser"], signal:"Navigation starts",
    from:"Address bar or link", to:"Browser navigation",
    message:"https = secure web; systems-from-zero.pages.dev = host; / = homepage path.",
    state:"No page bytes have arrived.",
    why:"The host identifies the site. The path identifies the resource on that site.",
    build:"Network shows the first document request and its full URL.",
    inside:"A URL can also include a port, query, and fragment. The fragment after # is not sent as the HTTP request target. A redirect can change the final URL.",
    failure:"A malformed or unsupported URL can stop navigation before any network request.",
    rule:"DNS looks up the host, not the full URL or path.", source:"url"
  },
  {
    name:"Check local copies", title:"First, can the browser avoid the network?",
    lead:"In this first-visit example, there is no usable local copy. A later visit may use an HTTP cache or a site's service worker.",
    focus:["Browser","Local cache"], signal:"No local response on first visit",
    from:"Browser navigation", to:"HTTP cache and optional service worker",
    message:"Look for a usable saved response. If none applies, continue to the network.",
    state:"First visit: network needed. Return visit: saved bytes may be reused or validated.",
    why:"A saved response can shorten a visit when its cache rules allow reuse.",
    build:"In Network, compare Size and headers on a normal reload and with Disable cache enabled.",
    inside:"HTTP cache stores responses. A service worker can intercept requests if the site installs one. Back/forward cache is different: it can restore an entire earlier page.",
    failure:"Overly broad cache rules can show stale content. Not every reload follows the same route.",
    rule:"A local shortcut changes the trip, not what the URL means.", source:"cache"
  },
  {
    name:"Resolve the name", title:"DNS finds an address for the host.",
    lead:"The browser or operating system asks a DNS resolver for systems-from-zero.pages.dev. The resolver can use a cached answer or consult authoritative DNS.",
    focus:["Browser","DNS resolver","DNS authority"], signal:"Host → IP address",
    from:"Browser or OS → recursive resolver", to:"Authoritative DNS if needed",
    message:"Ask for address records; return one or more IP addresses with a cache lifetime.",
    state:"The browser has an address it can try.",
    why:"Network packets need an address. DNS translates the site name into one.",
    build:"Network Timing may show DNS lookup on a cold connection; reuse can make this phase disappear.",
    inside:"The recursive resolver searches on the client's behalf. The authoritative server owns the records. Caches at several layers can skip a fresh lookup.",
    failure:"A missing record or resolver failure can stop the visit before HTTP starts.",
    rule:"DNS gives a destination; it does not prove the server's identity.", source:"dns"
  },
  {
    name:"Reach the edge", title:"Packets head toward the serving network.",
    lead:"The browser sends packets to the chosen address. This site uses Cloudflare Pages, so a Cloudflare edge handles the web request.",
    focus:["Browser","Cloudflare edge"], signal:"Network path chosen",
    from:"Visitor device and network", to:"Cloudflare edge address",
    message:"Packets carry a destination IP. Routers forward them; routers do not use the URL path.",
    state:"The browser can try to connect to the serving network.",
    why:"Finding an address is separate from reaching it across the network.",
    build:"Network can show Remote address. It can differ with location and later visits.",
    inside:"A CDN places service near users. Which edge answers and whether it already holds this asset can vary.",
    failure:"Routing or connectivity trouble can prevent connection even after DNS succeeds.",
    rule:"An edge IP is a route target, not the identity shown in the address bar.", source:"pages"
  },
  {
    name:"Open transport", title:"The browser opens TCP or QUIC.",
    lead:"HTTP/2 normally uses TCP. HTTP/3 uses QUIC over UDP. If a suitable connection is already open, the browser may reuse it.",
    focus:["Browser","Cloudflare edge"], signal:"Transport ready",
    from:"Browser transport stack", to:"Cloudflare edge",
    message:"Connection setup and protocol negotiation, unless an existing connection is reused.",
    state:"A path is ready to carry secure HTTP.",
    why:"The browser needs a reliable exchange of data with the serving endpoint.",
    build:"Enable Protocol in Network. Timing can reveal a new connection.",
    inside:"HTTP/3's QUIC includes a TLS 1.3 security handshake. The next step explains that same check; QUIC does not add a separate TLS-over-TCP trip.",
    failure:"A failed connection or blocked UDP can lead to retry or fallback. Do not assume every visit uses HTTP/3.",
    rule:"HTTP version changes transport, not what GET and 200 mean.", source:"http3"
  },
  {
    name:"Verify the site", title:"HTTPS checks identity and sets up encryption.",
    lead:"The browser validates a certificate for the requested host and establishes keys. With QUIC, this is part of connection setup.",
    focus:["Browser","Cloudflare edge"], signal:"TLS check completed",
    from:"Edge certificate and handshake", to:"Browser trust check",
    message:"Host certificate, protocol choices, and key exchange.",
    state:"The connection can carry encrypted HTTP.",
    why:"The IP from DNS is not proof the endpoint is allowed to speak for the host.",
    build:"Browser site information shows certificate details. A certificate failure differs from DNS failure.",
    inside:"HTTPS protects data on the browser-to-server connection. It does not make every script or link on a page trustworthy.",
    failure:"An expired, mismatched, or untrusted certificate blocks or warns on navigation.",
    rule:"DNS finds the address; TLS checks the name.", source:"browser"
  },
  {
    name:"Ask for the page", title:"The browser sends an HTTP request.",
    lead:"It asks for the homepage document with GET /. The host is also sent in HTTP request metadata.",
    focus:["Browser","Cloudflare edge"], signal:"GET / sent",
    from:"Browser → Cloudflare edge", to:"Homepage resource",
    message:"GET / for systems-from-zero.pages.dev, plus applicable headers and cookies.",
    state:"Waiting for an HTTP response.",
    why:"Connection setup provides the route; HTTP names the resource and action.",
    build:"Open the document request in Network and inspect Headers.",
    inside:"A redirect can trigger a second request. A repeat visit might send If-None-Match to check whether a saved response is still current.",
    failure:"A 404 or 5xx is an HTTP response. DNS and TLS failures happen before one exists.",
    rule:"The / path goes to the web server, not DNS.", source:"http"
  },
  {
    name:"Find the file", title:"Cloudflare Pages locates deployed HTML.",
    lead:"For this static site, Pages serves the homepage asset. It can come from an edge cache or another part of Pages' asset storage and cache path.",
    focus:["Cloudflare edge","Pages assets"], signal:"HTML asset found",
    from:"Cloudflare edge", to:"Deployed Pages asset",
    message:"Map path / to the current deployment's homepage file.",
    state:"HTML bytes are ready to return.",
    why:"The requested path needs a body. Here that body is a deployed file, not a database query.",
    build:"This repository's root index.html is the homepage file that Pages deploys.",
    inside:"A dynamic app might instead run code, check a session, query a database, and generate HTML. That is a different origin path.",
    failure:"A missing asset can return 404 or a configured fallback; caching can expose an older deployment.",
    rule:"CDN cache and browser cache are separate decisions.", source:"pages"
  },
  {
    name:"Receive HTML", title:"Status, headers, and bytes return.",
    lead:"The document response can carry 200 OK, Content-Type: text/html, ETag, and an HTML body. Parsing may begin before the whole body arrives.",
    focus:["Cloudflare edge","Browser"], signal:"HTML response received",
    from:"Cloudflare edge → browser", to:"HTML parser",
    message:"Example: 200 OK; Content-Type: text/html; ETag; then HTML bytes.",
    state:"The document is arriving; the screen may still be blank.",
    why:"Status says what happened, headers explain the bytes, and the body supplies the page.",
    build:"Network Headers shows status and response headers; Response shows HTML.",
    inside:"On a later request, matching ETag and If-None-Match can produce 304 Not Modified with no body; the browser uses its saved copy.",
    failure:"Wrong content type, incomplete transfer, or an error status can stop the expected display.",
    rule:"200 delivers a body; 304 validates a saved one.", source:"cache"
  },
  {
    name:"Discover page parts", title:"HTML leads to more requests.",
    lead:"The browser builds a DOM from HTML and finds home.css and the favicon. It can fetch these while parsing continues.",
    focus:["Browser","HTML parser","Cloudflare edge"], signal:"DOM and CSS requests",
    from:"HTML parser", to:"DOM, CSS parser, resource fetches",
    message:"HTML tags become DOM nodes; link rel=stylesheet requests home.css.",
    state:"Document structure exists; styles may still be loading.",
    why:"One HTML response often points to separate files needed for the page.",
    build:"Network Initiator shows why each resource was requested; Elements shows the DOM.",
    inside:"CSS becomes a CSSOM. Classic scripts can pause parsing; deferred scripts run after parsing. Resource requests overlap rather than forming one strict queue.",
    failure:"A missing stylesheet leaves readable but unstyled HTML. A failed script may leave static content visible but interaction broken.",
    rule:"One page load can trigger many requests and even new DNS lookups.", source:"browser"
  },
  {
    name:"Draw the page", title:"The browser turns structure into pixels.",
    lead:"It applies styles, computes sizes and positions, paints visible elements, and composites layers. The page can appear before every resource finishes.",
    focus:["HTML parser","Renderer"], signal:"First pixels appear",
    from:"DOM + CSSOM", to:"Layout, paint, composite",
    message:"Visible nodes + computed styles → positions → pixels.",
    state:"Page visible; later assets or scripts can still change it.",
    why:"Receiving HTML is different from showing a usable page.",
    build:"Performance shows browser work; Network can show CSS that delayed first render.",
    inside:"Late images without reserved dimensions can shift layout. Long JavaScript work can delay interaction after the first paint.",
    failure:"If the network succeeded but the page is blank, inspect HTML, CSS, and console errors before blaming DNS.",
    rule:"The server sends bytes; the browser draws the pixels.", source:"browser"
  },
  {
    name:"Use it and return", title:"Interaction starts; later visits may be shorter.",
    lead:"Links work. On pages with scripts, code can handle interaction. A reload may reuse resources; Back may restore a whole page without this network path.",
    focus:["Browser","Local cache","Renderer"], signal:"Page usable",
    from:"Browser event loop and caches", to:"User action and later navigation",
    message:"Clicks trigger navigation or code; repeat visits may reuse connections, cached responses, or a page snapshot.",
    state:"Usable page; a future visit need not repeat every earlier step.",
    why:"A visible page can have broken interaction, and a warm visit can hide a slow first load.",
    build:"Compare first visit, reload, and Back in DevTools. Record which requests really happen.",
    inside:"Back/forward cache saves a whole page with JavaScript state. HTTP cache stores individual responses. A service worker is another optional layer.",
    failure:"Long scripts block input. A cache miss or new connection can make a repeat visit slow.",
    rule:"Measure this visit's path; do not assume every visit starts from zero.", source:"bfcache"
  }
];

const $ = id => document.getElementById(id);
const ui = {
  steps:$("steps"), number:$("step-number"), progress:$("progress-fill"),
  title:$("step-title"), lead:$("step-summary"), route:$("route"), signal:$("signal"), layers:$("layers"),
  from:$("handoff-from"), to:$("handoff-to"), message:$("handoff-message"), state:$("handoff-state"),
  why:$("step-why"), build:$("step-tech"), inside:$("step-inside"), failure:$("step-failure"),
  rule:$("takeaway"), source:$("step-source"), previous:$("previous"), next:$("next")
};
let current = 0;
ui.steps.innerHTML = steps.map((step,index) =>
  '<button type="button" role="tab" aria-controls="step-content" aria-selected="false" tabindex="-1" data-step="'+index+'"><span>'+
  String(index+1).padStart(2,"0")+'</span>'+step.name+'</button>'
).join("");
function render(){
  const step=steps[current];
  ui.number.textContent="STEP "+String(current+1).padStart(2,"0")+" OF "+steps.length;
  ui.progress.style.width=((current+1)/steps.length*100)+"%";
  ui.title.textContent=step.title;ui.lead.textContent=step.lead;ui.signal.textContent=step.signal;
  ui.from.textContent=step.from;ui.to.textContent=step.to;ui.message.textContent=step.message;
  ui.state.textContent=step.state;ui.why.textContent=step.why;ui.build.textContent=step.build;
  ui.inside.textContent=step.inside;ui.failure.textContent=step.failure;ui.rule.textContent=step.rule;
  ui.source.textContent=sources[step.source][0];ui.source.href=sources[step.source][1];
  ui.previous.disabled=current===0;
  ui.next.textContent=current===steps.length-1?"Start again ↺":"Next step →";
  ui.steps.querySelectorAll("button").forEach((button,i)=>{const active=i===current;button.setAttribute("aria-selected",String(active));button.tabIndex=active?0:-1});
  const active=participants.filter(node=>node.added<=current);
  ui.route.innerHTML=active.map((node,i)=>
    '<div class="route-node'+(step.focus.includes(node.name)?' is-focus':'')+(node.added===current?' is-new':'')+
    '"><span class="route-index">'+String(i+1).padStart(2,"0")+'</span><strong>'+node.name+
    '</strong><small>'+node.detail+'</small></div>'+(i<active.length-1?'<span class="route-arrow" aria-hidden="true">↓</span>':'')
  ).join("");
  ui.layers.innerHTML=layers.map(layer=>{
    const shown=layer.items.filter(item=>item.at<=current);
    if(!shown.length)return "";
    return '<div class="layer"><span>'+layer.name+'</span><p>'+
      shown.map(item=>'<strong'+(item.at===current?' class="is-new"':'')+'>'+item.label+'</strong>').join('<i aria-hidden="true">→</i>')+
      '</p></div>';
  }).join("");
}
function selectStep(index,focus=false){
  current=Math.max(0,Math.min(steps.length-1,index));render();
  const button=ui.steps.querySelectorAll("button")[current];
  if(focus)button.focus();
  if(typeof window!=="undefined"){
    const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if(window.matchMedia("(max-width: 720px)").matches)ui.steps.scrollTo({
      left:button.offsetLeft-ui.steps.offsetLeft-(ui.steps.clientWidth-button.offsetWidth)/2,
      behavior:reduced?"auto":"smooth"
    });
    ui.title.scrollIntoView({block:"nearest",behavior:reduced?"auto":"smooth"});
  }
}
ui.steps.addEventListener("click",event=>{const button=event.target.closest("button[data-step]");if(button)selectStep(Number(button.dataset.step))});
ui.steps.addEventListener("keydown",event=>{
  const target=event.key==="ArrowRight"||event.key==="ArrowDown"?current+1:
    event.key==="ArrowLeft"||event.key==="ArrowUp"?current-1:
    event.key==="Home"?0:event.key==="End"?steps.length-1:null;
  if(target===null)return;event.preventDefault();selectStep(target,true);
});
ui.previous.addEventListener("click",()=>selectStep(current-1));
ui.next.addEventListener("click",()=>selectStep(current===steps.length-1?0:current+1));
render();
