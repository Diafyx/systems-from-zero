const sources = {
  overview:["Google Search Central: crawl, index, serve", "https://developers.google.com/search/docs/fundamentals/how-search-works"],
  sitemap:["Google Search Central: sitemap hints", "https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap"],
  robots:["RFC 9309: robots.txt rules", "https://www.rfc-editor.org/rfc/rfc9309"],
  http:["RFC 9110: HTTP responses", "https://www.rfc-editor.org/rfc/rfc9110"],
  noindex:["Google Search Central: noindex rules", "https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag"],
  canonical:["Google Search Central: duplicate and canonical URLs", "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls"],
  postings:["Lucene: postings enumeration", "https://lucene.apache.org/core/10_3_2/core/org/apache/lucene/index/PostingsEnum.html"],
  analyzer:["OpenSearch: standard analyzer", "https://docs.opensearch.org/latest/analyzers/supported-analyzers/standard/"],
  bm25:["Lucene: BM25 similarity", "https://lucene.apache.org/core/10_5_2/core/org/apache/lucene/search/similarities/BM25Similarity.html"],
  multimatch:["OpenSearch: multi-match queries", "https://docs.opensearch.org/latest/query-dsl/full-text/multi-match/"],
  ranking:["Google Search: ranking signals", "https://www.google.com/search/howsearchworks/how-search-works/ranking-results/"],
  spam:["Google Search Central: web spam examples", "https://developers.google.com/search/docs/essentials/spam-policies"],
  highlight:["OpenSearch: result highlighting", "https://docs.opensearch.org/latest/search-plugins/searching-data/highlight/"],
  refresh:["OpenSearch: index refresh", "https://docs.opensearch.org/latest/im-plugin/index-maintenance/"],
  ssrf:["OWASP: safe URL fetching", "https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html"],
  postgres:["PostgreSQL: SELECT and SKIP LOCKED", "https://www.postgresql.org/docs/current/sql-select.html"],
  shards:["OpenSearch: shards and replicas", "https://docs.opensearch.org/latest/getting-started/intro/"],
  distributed:["OpenSearch: a query through shards", "https://opensearch.org/blog/a-query-or-there-and-back-again/"]
};

const participants = [
  {name:"Public pages",detail:"HTML and links on the web",added:0},
  {name:"PostgreSQL",detail:"URL and page records",added:0},
  {name:"Reader's browser",detail:"Searches and opens results",added:1},
  {name:"Search API",detail:"Answers the query",added:1},
  {name:"URL frontier",detail:"Schedules allowed pages",added:2},
  {name:"Crawl worker",detail:"Fetches and extracts",added:3},
  {name:"OpenSearch",detail:"Matches and scores documents",added:7}
];

const layers = [
  {name:"FIRST SEARCH",items:[{at:0,label:"Three saved pages"},{at:1,label:"Scan and show"}]},
  {name:"FIND PAGES",items:[{at:2,label:"URL discovery"},{at:3,label:"robots + pacing"},{at:4,label:"HTTP fetch"},{at:5,label:"Extract + noindex"},{at:6,label:"Canonical group"}]},
  {name:"ANSWER FAST",items:[{at:7,label:"Inverted index"},{at:8,label:"Query terms"},{at:9,label:"BM25"},{at:10,label:"Title signal"},{at:11,label:"Source checks"},{at:12,label:"Snippet"}]},
  {name:"KEEP IT USEFUL",items:[{at:13,label:"Recrawl"},{at:14,label:"Worker queue"},{at:15,label:"Shards"},{at:16,label:"Measure failures"}]}
];

const steps = [
  {
    name:"Save three pages",title:"The first search engine starts with pages it already has.",
    lead:"Store three public gardening pages by hand in PostgreSQL: d1 Grow basil indoors, d2 Indoor herb guide, and d3 Pruning basil outside. Each row has a URL, title, and plain-text body.",
    focus:["Public pages","PostgreSQL"],signal:"Three document rows",
    from:"Public pages",to:"PostgreSQL documents table",message:"id, url, title, body, fetched_at for d1, d2, d3.",
    state:"There is a tiny searchable collection. No crawler or special index exists.",
    why:"A fixed set proves the search flow before the system must discover the web.",
    build:"Create a documents table with a stable document ID and unique canonical URL. Insert three example rows; keep the original title and extracted body separate.",
    inside:"This collection is only three pages, not the whole web. A page can exist on the web and be absent from these rows.",
    failure:"If a URL is stored twice under different IDs, the same page can appear twice in results.",
    rule:"A search engine can only search what it has collected and indexed.",source:"overview"
  },
  {
    name:"Answer the first query",title:"Scan the small table and return a result.",
    lead:"Nina searches grow basil indoors. The Search API scans the three saved titles and bodies, counts matching words, and shows d1 before the weaker matches.",
    focus:["Reader's browser","Search API","PostgreSQL"],signal:"GET /search?q=grow+basil+indoors",
    from:"Reader's browser",to:"Search API → PostgreSQL",message:"Normalized words: grow, basil, indoors; scan 3 rows; return title, URL, preview.",
    state:"Nina can click a result. The app did not visit websites while she waited.",
    why:"A table scan and a simple score are enough at this size and make the basic promise visible.",
    build:"Tokenize the query, scan the stored text, rank by number of distinct query words matched, break ties by title matches, and return at most ten results.",
    inside:"This teaching score is not BM25. With a small table, a scan is simple; scanning millions of long pages for every query would be slow.",
    failure:"A page that was never loaded cannot match. A query with no overlapping words returns an honest empty state.",
    rule:"Search reads a prepared collection; crawling happens before the query.",source:"overview"
  },
  {
    name:"Discover URLs",title:"A crawler needs a list of pages to visit.",
    lead:"Seed the URL frontier with known pages. Parse links in fetched pages and optional sitemaps to discover more URLs, such as a linked article about basil light.",
    focus:["Public pages","URL frontier","PostgreSQL"],signal:"New URL queued",
    from:"Known page links + sitemap",to:"URL frontier",message:"https://example.test/garden/basil-light → status=DISCOVERED.",
    state:"The system knows the address, but has not fetched or indexed that page.",
    why:"There is no central list of every web page. Links and sitemaps provide leads.",
    build:"Store normalized absolute HTTP(S) URLs with unique keys, discovery source, next_fetch_at, and state. Avoid duplicate entries; treat sitemap entries as hints, not guaranteed pages.",
    inside:"A URL can be discovered from a link while its content is unavailable or blocked. Discovery is not crawling, and neither guarantees indexing.",
    failure:"A URL with endless parameters can create an infinite crawl trap. Limit allowed patterns and per-site discovery growth.",
    rule:"A discovered URL is a candidate for a future fetch.",source:"sitemap"
  },
  {
    name:"Respect each site",title:"Check crawl rules before requesting a page.",
    lead:"The worker fetches that site's /robots.txt, checks the rule for its crawler name, and waits between requests to the host. A disallowed URL is not fetched.",
    focus:["URL frontier","Crawl worker","Public pages"],signal:"robots allowed + host slot",
    from:"Crawl worker",to:"Site /robots.txt + host scheduler",message:"GET /robots.txt; match user-agent and path; reserve a paced fetch slot.",
    state:"An allowed URL may be fetched when its host has capacity.",
    why:"The crawler must honor a site's crawl instructions and avoid flooding its server.",
    build:"Implement RFC 9309 rule matching, cache rules for a bounded period, use an identifying User-Agent, and cap concurrent requests per host.",
    inside:"robots.txt controls crawler access, not authentication. An unavailable robots file and a server error have different protocol handling; fail closed on a temporarily unreachable file.",
    failure:"Ignoring redirects or rule specificity can fetch a blocked path. Recheck the final URL after a redirect.",
    rule:"Permission to crawl is checked before page bytes are requested.",source:"robots"
  },
  {
    name:"Fetch the page",title:"Download the response and record what happened.",
    lead:"The worker requests /garden/basil-light. A 200 HTML response yields page bytes; a 404 means the page is gone; a 5xx or timeout is retried later.",
    focus:["Crawl worker","Public pages","PostgreSQL"],signal:"HTTP response recorded",
    from:"Crawl worker",to:"Public page host",message:"GET /garden/basil-light → status, final URL, headers, body, fetched_at.",
    state:"The crawler has a response, but it has not decided whether to show the page in search.",
    why:"The index must reflect actual responses, not just URLs from links or sitemaps.",
    build:"Limit response size and time, accept supported HTML media types, record redirects and status, and retry transient failures with backoff.",
    inside:"Treat page URLs and redirects as untrusted. Block loopback, private networks, and cloud metadata endpoints; resolve and validate destinations before connection.",
    failure:"A host can return a 200 login page or enormous body. HTTP success alone does not mean useful indexable content.",
    rule:"Fetch records facts about the response; indexing is a later decision.",source:"ssrf"
  },
  {
    name:"Extract useful text",title:"Turn HTML into a document the search engine can understand.",
    lead:"Parse the page title, main text in the HTML, language, links, and any robots noindex instruction. Remove navigation and boilerplate where possible; skip indexing when noindex applies.",
    focus:["Crawl worker","PostgreSQL","URL frontier"],signal:"Structured page extracted",
    from:"Fetched HTML",to:"Document row + discovered links",message:"title='Basil light indoors'; body='...'; language=en; links=[...]; indexable=true.",
    state:"The page can become a document, and its links can add future URLs.",
    why:"Raw HTML is noisy. Ranking needs text fields, and the crawler must honor page-level index rules.",
    build:"Use a real HTML parser. Separate title and main body. Read robots meta or X-Robots-Tag before indexing; store extraction version so changed rules can trigger reprocessing.",
    inside:"robots.txt can prevent the fetch needed to see noindex. A site that wants a crawler to read noindex must allow access to that page.",
    failure:"A JavaScript-only page can look empty to a simple HTML crawler. Add a controlled rendering worker only when the target corpus needs it.",
    rule:"Fetched does not mean indexable; extract and apply page rules first.",source:"noindex"
  },
  {
    name:"Choose one URL",title:"Group copies of the same content.",
    lead:"The same basil guide may appear at /basil and /basil?print=1. Group near-identical content, consider redirects and rel=canonical hints, and choose one URL for the result.",
    focus:["Crawl worker","PostgreSQL"],signal:"One canonical document",
    from:"Extracted duplicate pages",to:"Canonical document record",message:"/basil?print=1 → canonical_doc_id=d1 → /basil.",
    state:"The result page can show one representative instead of two copies.",
    why:"Duplicate URLs waste index space and crowd out distinct answers.",
    build:"Normalize safe URL variations, hash cleaned content for exact copies, compare similarity for near copies, then choose one representative. Treat rel=canonical as a hint, not an unquestioned command.",
    inside:"Two pages can share much text yet serve different purposes. Compare content and signals before merging; preserve alternate URLs for later crawl and redirects.",
    failure:"An overly broad duplicate rule can erase a genuinely different page from results.",
    rule:"One result should represent one content group, not every URL copy.",source:"canonical"
  },
  {
    name:"Build an inverted index",title:"Stop reading every page for every query.",
    lead:"Move searchable documents to OpenSearch. It analyzes title and body into terms and builds postings: a term points to document IDs containing it.",
    focus:["PostgreSQL","OpenSearch"],signal:"Terms → document IDs",
    from:"Extracted canonical documents",to:"OpenSearch pages index",message:"basil → d1,d2,d3; indoors → d1,d2; grow → d1,d3.",
    state:"The engine can jump to likely documents instead of scanning all bodies.",
    why:"A table scan grows with the collection; an inverted index starts from query terms.",
    build:"Create text fields for title and body, keyword fields for URL and language, and use canonical document ID as the OpenSearch _id. Upsert only indexable representatives.",
    inside:"A posting can carry term frequency and positions as well as document ID. OpenSearch uses Lucene indexes internally; the search index is derived from crawler records.",
    failure:"If a batch is partially indexed, some pages are temporarily missing. Keep source records so the index can be rebuilt or reconciled.",
    rule:"The inverted index maps words to documents; it does not rank them yet.",source:"postings"
  },
  {
    name:"Find candidates",title:"Analyze Nina's query the same way as page text.",
    lead:"For grow basil indoors, the standard analyzer lowercases and splits words. The engine reads matching posting lists and forms candidate documents before scoring.",
    focus:["Reader's browser","Search API","OpenSearch"],signal:"Candidate set found",
    from:"Search API",to:"OpenSearch terms and postings",message:"grow ∪ basil ∪ indoors → d1,d2,d3 (using OR-style matching).",
    state:"The engine has candidate IDs; it has not decided the final order.",
    why:"Query analysis must agree with index analysis so capitalization and punctuation do not break ordinary matches.",
    build:"Use the same analyzer on title/body and query, set an explicit candidate matching policy, and cap query length and returned hits.",
    inside:"The standard analyzer lowercases and tokenizes; it does not automatically understand that basil and sweet herb mean the same thing. OR increases recall; AND narrows results.",
    failure:"A typo or different word form may produce no matching posting. Add spelling or language-specific analysis only after measuring this problem.",
    rule:"Candidate retrieval finds possible answers; it is separate from scoring.",source:"analyzer"
  },
  {
    name:"Score with BM25",title:"Give stronger text matches higher scores.",
    lead:"OpenSearch scores the candidates with BM25. A document generally gains from matching query terms, especially less common terms, while term repetition and long fields are normalized.",
    focus:["Search API","OpenSearch"],signal:"BM25 score per candidate",
    from:"OpenSearch postings + field statistics",to:"Ranked candidate list",message:"d1, d2, d3 get scores based on term frequency, rarity, and field length.",
    state:"The likely answer d1 can move above pages with weaker overlap; exact scores depend on the indexed corpus.",
    why:"Counting matched words alone cannot distinguish a focused article from a long page that repeats common words.",
    build:"Start with OpenSearch's BM25 text scoring. Test a fixed set of queries and inspect score explanations before changing parameters.",
    inside:"BM25 uses document frequency, term frequency, and field length. Lucene's default k1=1.2 and b=0.75 are parameters, not universal correctness settings.",
    failure:"A page can game word frequency. Text relevance alone does not prove accuracy, safety, or trustworthiness.",
    rule:"BM25 ranks matching text; it is not a fact checker.",source:"bm25"
  },
  {
    name:"Weight useful fields",title:"A title match can mean more than a passing body mention.",
    lead:"For this gardening collection, boost title matches above body matches. Keep the boost modest and evaluate it on queries where the expected result is known.",
    focus:["Search API","OpenSearch"],signal:"title^2, body",
    from:"Search API",to:"OpenSearch multi_match query",message:"query='grow basil indoors'; fields=['title^2','body']; take 50 text candidates.",
    state:"A focused title can outrank a long page with a stray body mention.",
    why:"The page author usually puts the central topic in the title, but title text can also be misleading.",
    build:"Use a multi_match query with title^2 and body. Add language filtering when the product serves multiple languages; test before adding freshness or link signals.",
    inside:"The ^2 field boost is a query-time weight, not a guaranteed doubling of the final score. OpenSearch's default best_fields mode mainly uses the strongest field score.",
    failure:"An extreme title boost rewards clickbait titles. Keep a judged query set and inspect regressions after weight changes.",
    rule:"Ranking weights are product choices that must be checked against real queries.",source:"multimatch"
  },
  {
    name:"Check source signals",title:"Text relevance is only the first ranking pass.",
    lead:"From the strongest text candidates, keep English pages for this English query and remove known abusive or unsafe results. For near-tied pages, a capped signal from independent linking hosts may help break the tie.",
    focus:["Search API","OpenSearch","PostgreSQL"],signal:"Top candidates checked",
    from:"OpenSearch top text hits + crawl records",to:"Search API final order",message:"language=en; exclusion policy; small, capped link signal only for close text scores.",
    state:"The final list can avoid a strong keyword match that is irrelevant or clearly abusive.",
    why:"A page can repeat query words or write a perfect title without being a good answer.",
    build:"Keep an explicit exclusion list for verified abuse, record distinct linking hosts during crawling, and use that count only as a bounded tie-breaker. Evaluate changes on human-judged queries.",
    inside:"Links are useful signals but can be bought or manufactured. Freshness matters for changing topics, but this basil-care query should not automatically prefer the newest page.",
    failure:"A crude link count favors spam networks and old popular sites. A broad exclusion rule can hide legitimate pages; keep decisions reviewable.",
    rule:"Text score finds relevance; source signals need limits and evaluation.",source:"ranking"
  },
  {
    name:"Show the result",title:"Turn ranked documents into a useful results page.",
    lead:"The API returns each result's canonical URL, title, and a short passage around the matched terms. Nina sees why d1 matched before opening it.",
    focus:["Search API","OpenSearch","Reader's browser"],signal:"Top results rendered",
    from:"OpenSearch → Search API",to:"Reader's browser",message:"[{title:'Grow basil indoors',url:'/basil',snippet:'...basil...indoors...'}]",
    state:"Nina can compare results and open the source page.",
    why:"A bare list of URLs is hard to judge; a relevant snippet helps the reader choose.",
    build:"Take the top text candidates, apply source checks, show at most ten, and highlight a short body fragment. Render title, URL, and snippet as untrusted text; allow only controlled highlight markup.",
    inside:"A highlighted fragment is a preview, not proof that the whole article answers the question. Snippet generation may require extra work on long fields.",
    failure:"Rendering raw HTML from a crawled page can inject scripts into the results page. Escape content before display.",
    rule:"A result needs source, title, and evidence for the match.",source:"highlight"
  },
  {
    name:"Keep pages current",title:"Revisit changed pages and remove dead ones.",
    lead:"The basil article changes or disappears. The frontier schedules another fetch; the worker updates its document and OpenSearch entry, or removes the result if the page is gone or now noindex.",
    focus:["URL frontier","Crawl worker","PostgreSQL","OpenSearch"],signal:"Recrawl → update/delete",
    from:"New crawl result",to:"PostgreSQL + OpenSearch",message:"Same canonical _id=d1; upsert changed text, or delete when excluded/removed.",
    state:"Search eventually reflects the latest successful crawl and index refresh.",
    why:"A one-time index goes stale; users need live URLs and current text.",
    build:"Set next_fetch_at by change history and site capacity. Use stable IDs for upserts; treat 404/410 and noindex as removal signals, while retrying transient failures.",
    inside:"An OpenSearch write is not necessarily searchable at once; refresh makes new index segments visible. A temporary 5xx should not instantly erase a previously good result.",
    failure:"A crash between database update and index update leaves a mismatch. Reconcile rows and index IDs with an idempotent worker.",
    rule:"Freshness comes from recrawl plus index updates, not from query-time fetching.",source:"refresh"
  },
  {
    name:"Add crawl workers",title:"A durable frontier coordinates more than one fetcher.",
    lead:"As the URL list grows, workers claim due rows from PostgreSQL, lease them, and report success or retry. A per-host scheduler still limits how fast any one site is fetched.",
    focus:["URL frontier","Crawl worker","PostgreSQL"],signal:"Leased crawl jobs",
    from:"PostgreSQL frontier",to:"Several crawl workers",message:"DISCOVERED/DUE → LEASED → FETCHED or RETRY_AT; unique URL key.",
    state:"More pages can be crawled without two workers intentionally fetching the same URL at once.",
    why:"One worker eventually falls behind a growing and changing collection.",
    build:"Claim due URLs in one transaction with FOR UPDATE SKIP LOCKED, set a lease deadline, and separately reserve a host slot. Reclaim expired leases, apply bounded backoff, and make indexing safe on duplicate deliveries.",
    inside:"A lease prevents most overlap but cannot guarantee exactly-once work. A slow worker may finish after its lease expires; stable document IDs make repeats safe.",
    failure:"If workers ignore host pacing, adding workers can overload sites. If leases never expire, crashed jobs stay stuck.",
    rule:"Scale crawlers with durable claims and idempotent updates.",source:"postgres"
  },
  {
    name:"Split the search index",title:"Shards let the index outgrow one machine.",
    lead:"When one OpenSearch node cannot hold or serve the collection, divide the index into primary shards and place replicas on other nodes. Queries run against a copy of each shard and merge the top hits.",
    focus:["Search API","OpenSearch"],signal:"Shard top hits merged",
    from:"Search API",to:"OpenSearch coordinating node → shard copies",message:"Each shard returns top candidates; coordinator merges and fetches the winning documents.",
    state:"The query still returns one result list while data and read load span nodes.",
    why:"The index and query traffic can become too large for one server.",
    build:"Size shards from measured data and traffic, add replicas for availability/read capacity, and monitor shard count, failed shards, and query latency.",
    inside:"Each primary shard owns a subset of documents; a replica copies that shard. Too many small shards waste resources. Cross-shard scores can differ when statistics are local.",
    failure:"A shard failure can produce partial results if the API accepts them. Expose or reject partial searches according to the product's correctness needs.",
    rule:"Shards spread the index; the coordinator still returns one ordered page.",source:"shards"
  },
  {
    name:"Check the whole flow",title:"Measure missing pages as well as slow queries.",
    lead:"Watch URL discovery, robots decisions, fetch status, extraction, index lag, query latency, and result quality for grow basil indoors and other known queries.",
    focus:["URL frontier","Crawl worker","PostgreSQL","OpenSearch","Search API","Reader's browser"],signal:"Find the broken stage",
    from:"Crawl + index + query events",to:"Dashboards and alerts",message:"discovered → fetched → indexable → indexed → candidate → ranked → clicked.",
    state:"A missing result can be traced to the exact stage that dropped it.",
    why:"A fast results page can still be wrong because discovery, crawling, or indexing failed earlier.",
    build:"Keep per-URL status and timestamps, index reconciliation counts, p95 query latency, shard failures, and a small judged query set. Show an honest empty or degraded state when search is unavailable.",
    inside:"Clicks can help evaluation but are biased by position and presentation; do not treat click count as proof a page is correct. Relevance evaluation needs human-checked examples.",
    failure:"If monitoring stops at API latency, stale or missing pages can go unnoticed while the service looks healthy.",
    rule:"A search result is the end of a pipeline; measure every stage.",source:"overview"
  }
];
