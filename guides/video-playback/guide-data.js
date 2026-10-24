const sources = {
  video: ["MDN: HTML video element", "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video"],
  faststart: ["FFmpeg: MP4 faststart", "https://ffmpeg.org/ffmpeg-all.html"],
  range: ["MDN: HTTP range requests", "https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests"],
  buffer: ["MDN: buffering and time ranges", "https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Audio_and_video_delivery/buffering_seeking_time_ranges"],
  hls: ["Apple: HTTP Live Streaming", "https://developer.apple.com/documentation/http-live-streaming"],
  ffmpeg: ["FFmpeg: HLS muxer", "https://ffmpeg.org/ffmpeg-formats.html"],
  playlist: ["RFC 8216: HLS playlist format", "https://www.rfc-editor.org/rfc/rfc8216"],
  variant: ["Apple: multivariant playlist", "https://developer.apple.com/documentation/http-live-streaming/creating-a-multivariant-playlist"],
  authoring: ["Apple: HLS authoring rules", "https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices/"],
  mse: ["MDN: Media Source Extensions", "https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API"],
  cache: ["CloudFront: cache behavior", "https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/ConfiguringCaching.html"]
};

const participants = [
  {name:"Encoder + packager",detail:"Prepares playable files",added:0},
  {name:"Viewer's browser",detail:"Requests and decodes",added:1},
  {name:"Video origin",detail:"Serves the MP4",added:2},
  {name:"Object storage",detail:"Holds published files",added:7},
  {name:"HLS player",detail:"Chooses and buffers segments",added:9},
  {name:"CDN",detail:"Caches files near viewers",added:14}
];

const layers = [
  {name:"FIRST VIDEO",items:[{at:0,label:"Playable MP4"},{at:1,label:"Video element"},{at:2,label:"HTTP request"},{at:3,label:"Initial bytes"},{at:4,label:"First frame"},{at:5,label:"Seek"}]},
  {name:"HLS FILES",items:[{at:6,label:"Quality variants"},{at:7,label:"Aligned segments"},{at:8,label:"Publish playlists"}]},
  {name:"HLS PLAYER",items:[{at:9,label:"Master playlist"},{at:10,label:"Variant playlist"},{at:11,label:"Init + segment"},{at:12,label:"Buffer + play"},{at:13,label:"Switch + seek"}]},
  {name:"AT SCALE",items:[{at:14,label:"CDN cache"},{at:15,label:"Recover stalls"}]}
];

const steps = [
  {
    name:"Prepare one MP4",title:"Start with one video file the browser can play.",
    lead:"A 90-second clip is encoded as an H.264 video track with AAC audio in an MP4. Put the MP4 index near the front so the browser can find track details early.",
    focus:["Encoder + packager"],signal:"clip.mp4 is ready",
    from:"Original video",to:"Playable MP4",message:"Transcode to H.264/AAC MP4; place the moov metadata before media data.",
    state:"One static file can be published. No HLS system exists yet.",
    why:"The decoder needs codec and timing information before it can show a frame. An MP4 with its index at the end may need a later byte request first.",
    build:"Use an encoder such as FFmpeg and its -movflags +faststart option for a normal MP4. Test the resulting file on the browsers and devices you support.",
    inside:"The MP4 moov box describes tracks and sample locations. Faststart moves that box toward the beginning after encoding; it does not shrink the video or turn it into HLS.",
    failure:"An unsupported codec or corrupt MP4 can download successfully and still fail to play.",
    rule:"A playable file needs supported codecs and early access to its metadata.",source:"faststart"
  },
  {
    name:"Open the page",title:"The page gives the browser a video URL.",
    lead:"The viewer opens a page with <video controls src=\"/media/clip.mp4\">. The browser decides when to fetch; the preload attribute is only a hint.",
    focus:["Viewer's browser"],signal:"Video URL known",
    from:"Web page",to:"Viewer's browser",message:"<video controls preload=\"metadata\" src=\"/media/clip.mp4\">",
    state:"The viewer can press Play. The browser has not necessarily downloaded the file.",
    why:"Built-in video controls and HTTP are enough for the first useful version.",
    build:"Render the video element with controls and a poster. Serve the MP4 with the correct Content-Type: video/mp4.",
    inside:"preload=metadata asks the browser to fetch just enough for metadata, but the browser may choose a different fetch pattern. Autoplay has separate browser rules.",
    failure:"A wrong URL, blocked request, or unsupported codec leaves the player unable to show the clip; surface a clear playback error.",
    rule:"The video element starts the flow; download behavior belongs to the browser.",source:"video"
  },
  {
    name:"Ask for bytes",title:"The browser requests the MP4 over HTTP.",
    lead:"The browser sends GET /media/clip.mp4. It may request a byte range such as Range: bytes=0-1048575; if the origin honors it, the response is 206 Partial Content with Content-Range.",
    focus:["Viewer's browser","Video origin"],signal:"GET /media/clip.mp4",
    from:"Viewer's browser",to:"Video origin",message:"GET /media/clip.mp4, optionally Range: bytes=0-1048575",
    state:"The origin is sending all or part of the file. The viewer has not seen a frame yet.",
    why:"HTTP can deliver the useful opening bytes without waiting for the entire 90-second file.",
    build:"Serve the static MP4 with correct Content-Type and byte-range support. Keep its URL stable while that file version is served.",
    inside:"A valid range response has status 206 and Content-Range, for example bytes 0-1048575/12000000. A server may ignore Range and return 200 with the full body; test the real origin.",
    failure:"If range support is broken, initial playback or seeking may become slow or fail. A 416 means the requested range is not satisfiable.",
    rule:"206 means a range was served; it is not a promise that every browser sends the same range.",source:"range"
  },
  {
    name:"Receive the opening",title:"Only the opening part needs to arrive first.",
    lead:"The browser receives the MP4 metadata and some opening media bytes. It can map samples to playback times and begin filling its buffer.",
    focus:["Viewer's browser","Video origin"],signal:"First bytes buffered",
    from:"Video origin",to:"Viewer's browser",message:"MP4 metadata plus enough opening media bytes; more bytes can arrive later.",
    state:"The browser knows how to decode the clip and has some playable data.",
    why:"The player needs a short lead, not the whole clip, before playback can begin.",
    build:"Inspect the browser's Network panel and video.buffered ranges. Measure bytes loaded before the first displayed frame.",
    inside:"Received bytes and buffered playback time are different measures. The browser can have bytes it cannot decode yet, or wait for a keyframe or more data.",
    failure:"If the network is slower than playback consumes data, the buffered lead drains and playback pauses.",
    rule:"Downloading bytes is not the same event as decoding a frame.",source:"buffer"
  },
  {
    name:"Show the first frame",title:"The decoder starts while later bytes are still arriving.",
    lead:"Once initialization data, a decodable frame, and enough buffer are available, the browser shows the first frame and plays. It keeps requesting data as needed.",
    focus:["Viewer's browser"],signal:"Playback begins",
    from:"Buffered MP4 data",to:"Browser decoder + screen",message:"Encoded H.264/AAC samples → decoded picture and sound.",
    state:"The viewer is watching while the rest of clip.mp4 may still be downloading.",
    why:"This already answers the main question: full-file download is not required to start.",
    build:"Track a start metric from Play to first frame or playing event; measure rebuffer events separately.",
    inside:"The decoder needs a suitable starting point such as a keyframe. How much buffer a browser waits for depends on its implementation and conditions.",
    failure:"If decoding fails, retrying the same bytes will not fix an unsupported format. Provide a compatible encoding.",
    rule:"A video can start when the first useful portion is ready.",source:"buffer"
  },
  {
    name:"Seek in the MP4",title:"A later playback time needs later bytes.",
    lead:"The viewer jumps to 00:45. Using the MP4 index, the browser finds an earlier decodable point and may request another byte range near that position.",
    focus:["Viewer's browser","Video origin"],signal:"Seek to 00:45",
    from:"Viewer's browser",to:"Video origin",message:"A later Range request for bytes near the samples needed at 00:45.",
    state:"Playback resumes near 00:45 after the required data arrives and decodes.",
    why:"Seeking should not require downloading every byte between the opening and the target time.",
    build:"Keep byte-range support and verify seeking at several points, including near the end. Do not assume time maps linearly to byte offset.",
    inside:"Variable bitrate means 45 seconds is not necessarily half the file. The MP4 index and keyframes let the browser locate a useful earlier point.",
    failure:"A missing index or bad range response can force extra downloading or make seeks stall.",
    rule:"A seek finds a decodable point near the requested time, then fetches its bytes.",source:"range"
  },
  {
    name:"Encode more qualities",title:"One large MP4 wastes time on a slow connection.",
    lead:"Now replay the same clip for many viewers. The encoder makes 360p, 720p, and 1080p versions so the player can choose a rate that fits the connection.",
    focus:["Encoder + packager"],signal:"Three quality variants",
    from:"Original video",to:"Encoder + packager",message:"One source → three H.264/AAC versions, each with a stated bandwidth and resolution.",
    state:"Several encodes exist, but the viewer still needs a way to choose and switch between them.",
    why:"A 1080p file may stall on a weak connection; always sending 360p wastes quality on a strong one.",
    build:"Encode a small bitrate ladder, measure actual output bitrate, and keep audio/video timing consistent between versions.",
    inside:"Resolution alone is not bandwidth. Bitrate controls bytes per second. The variant playlist advertises BANDWIDTH and CODECS so a player can evaluate each option.",
    failure:"If one variant uses an unsupported codec or broken timestamps, switching to it can fail despite a valid playlist.",
    rule:"Multiple qualities create choices; they do not yet create adaptive playback.",source:"variant"
  },
  {
    name:"Cut aligned segments",title:"Package each quality as short, addressable pieces.",
    lead:"The packager divides each version into roughly four-second segments and writes an initialization file for fragmented MP4. Segment boundaries align across qualities.",
    focus:["Encoder + packager","Object storage"],signal:"Aligned .m4s segments",
    from:"Encoder + packager",to:"Object storage",message:"360p/init.mp4 + seg000.m4s...; same layout for 720p and 1080p.",
    state:"The clip is available as small HTTP files, with matching time boundaries at each quality.",
    why:"The player can request only the next few seconds and choose a different quality for a later segment.",
    build:"Set keyframes/closed GOPs at intended boundaries before packaging. Use a target segment duration such as four seconds; verify actual cut points.",
    inside:"HLS target duration is not an exact cut timer. FFmpeg normally cuts at the next keyframe. fMP4 segments need an EXT-X-MAP initialization section in their media playlist.",
    failure:"Misaligned timestamps or missing keyframes can make a quality switch pause, repeat, or skip pictures.",
    rule:"A quality switch works cleanly when segment times and decode points line up.",source:"ffmpeg"
  },
  {
    name:"Publish playlists",title:"A playlist tells the player which files exist.",
    lead:"Each quality gets a media playlist listing its initialization file, segments, durations, and end marker. A master playlist lists the quality choices.",
    focus:["Encoder + packager","Object storage"],signal:"master.m3u8 published",
    from:"Encoder + packager",to:"Object storage",message:"master.m3u8 → 360p/index.m3u8, 720p/index.m3u8, 1080p/index.m3u8 → segments.",
    state:"A viewer can now discover and fetch the complete on-demand clip.",
    why:"The player needs a small map of available bitrates and exact segment URLs.",
    build:"Upload segment and init files first, then media playlists, then the master playlist. Mark the video READY in the app only after the referenced files exist.",
    inside:"A VOD media playlist ends with EXT-X-ENDLIST. EXTINF gives each segment duration; EXT-X-MAP points to fMP4 initialization data. These are text files, not video bytes.",
    failure:"Publishing a playlist before its files exist causes 404s during playback. A partially uploaded package must stay unavailable.",
    rule:"Publish references only after their files are ready.",source:"playlist"
  },
  {
    name:"Open the HLS version",title:"The upgraded player first fetches a tiny map.",
    lead:"The viewer reopens the same clip using its HLS route. The player requests master.m3u8 and reads the available variants. This is a replay of the clip using the upgraded system.",
    focus:["Viewer's browser","HLS player","Object storage"],signal:"GET master.m3u8",
    from:"HLS player",to:"Object storage",message:"GET /hls/clip/master.m3u8 → variant URLs with BANDWIDTH, RESOLUTION, and CODECS.",
    state:"The player knows the choices but has not downloaded a media segment.",
    why:"The player needs to select an appropriate quality before requesting media bytes.",
    build:"Use native HLS where available, or an HLS-capable JavaScript player using Media Source Extensions where supported. Test the target browsers.",
    inside:"HLS uses ordinary HTTP requests. A master playlist does not contain video frames. Native HLS and JavaScript/MSE players have different APIs and support by browser.",
    failure:"A broken master URL or unsupported player path prevents startup even when the segments exist.",
    rule:"The master playlist is a menu of streams, not the movie itself.",source:"hls"
  },
  {
    name:"Choose a variant",title:"The player picks a starting bitrate.",
    lead:"Suppose it begins at 720p. It requests 720p/index.m3u8, which lists the segment URLs and playback durations for that rendition.",
    focus:["HLS player","Object storage"],signal:"GET 720p/index.m3u8",
    from:"HLS player",to:"Object storage",message:"GET media playlist → EXT-X-MAP + ordered EXTINF segment entries.",
    state:"The player knows exactly which bytes cover the opening seconds at 720p.",
    why:"Starting at a moderate quality can reduce first-frame delay while measurements are still sparse.",
    build:"Let the player pick from supported variants; give it honest bitrate metadata and correctly ordered segment URLs.",
    inside:"The playlist is ordered by playback time. A player's first selection may use device size, known bandwidth, and its own startup policy; the exact choice is player-specific.",
    failure:"A playlist that points at another quality's init file or missing segment can fail at decode time.",
    rule:"The chosen media playlist maps time to concrete segment files.",source:"playlist"
  },
  {
    name:"Fetch the first segment",title:"The player asks for initialization and opening media.",
    lead:"The player fetches 720p/init.mp4 and 720p/seg000.m4s. The init file describes tracks; the segment carries encoded audio and video for the first few seconds.",
    focus:["HLS player","Object storage"],signal:"Init + seg000 fetched",
    from:"Object storage",to:"HLS player",message:"init.mp4 + seg000.m4s, fetched as separate HTTP objects.",
    state:"The player has the first decodable part of the HLS clip, not all 90 seconds.",
    why:"Small, independent requests let playback start while later segments remain untouched.",
    build:"Check that each fMP4 media playlist has EXT-X-MAP and that segment responses use a suitable video Content-Type. Verify timestamps and segment independence.",
    inside:"A video segment does not stand alone if it needs its initialization file. The player may prefetch more than one segment before starting.",
    failure:"If init.mp4 is missing or has the wrong codec description, the first segment can arrive but cannot be decoded.",
    rule:"An fMP4 segment needs its matching initialization data.",source:"authoring"
  },
  {
    name:"Buffer and play",title:"The player passes enough media to the decoder.",
    lead:"A native HLS stack or JavaScript player buffers the first segment(s), then the browser decodes frames and starts playback. It requests later segments ahead of the playhead.",
    focus:["Viewer's browser","HLS player"],signal:"First HLS frame shown",
    from:"HLS player",to:"Browser media decoder",message:"Initialization data and ordered segments → buffered time ranges → decoded frame.",
    state:"The viewer is watching before the whole clip has been fetched.",
    why:"HLS separates delivery into requests the player can schedule based on buffer health.",
    build:"For an MSE player, append compatible bytes to SourceBuffer in order and wait for updateend before the next append. Track startup time and buffer length.",
    inside:"SourceBuffer can reject an append when its buffer is full. A player must remove old buffered data safely and handle update errors. Native HLS hides this plumbing.",
    failure:"If upcoming segments arrive too slowly, the player enters a waiting state and playback stalls.",
    rule:"A playlist chooses files; the decoder still needs enough valid media to display a frame.",source:"mse"
  },
  {
    name:"Switch or seek",title:"The next request can change quality or time.",
    lead:"If the connection slows, the player can request the next aligned segment at 360p. If the viewer seeks to 00:45, it finds the segment covering that time and fetches from there.",
    focus:["HLS player","Object storage","Viewer's browser"],signal:"Next segment at 360p",
    from:"HLS player",to:"Object storage",message:"GET 360p/segNNN.m4s at the same timeline boundary; or fetch a segment near 00:45.",
    state:"Playback continues at a fitting quality or resumes near the requested time.",
    why:"The system can spend fewer bytes during congestion and skip unneeded earlier segments on a seek.",
    build:"Choose future segment quality from measured throughput, buffer, and device limits. Keep rendition segment timelines aligned and avoid changing quality on every sample.",
    inside:"Adaptive bitrate changes later requests; it does not turn an already downloaded 720p segment into 360p. Seeking may need a segment that starts before 00:45 to decode to the target.",
    failure:"Aggressive switching oscillates in quality. A bad timestamp boundary can produce a visible gap at a switch or seek.",
    rule:"Adaptation changes which future segment is fetched.",source:"variant"
  },
  {
    name:"Add a CDN",title:"Popular segments should come from a nearby cache.",
    lead:"As viewership grows, put a CDN in front of object storage. The first request at an edge fetches from origin; later viewers can receive the same immutable segment from that edge.",
    focus:["Viewer's browser","HLS player","CDN","Object storage"],signal:"CDN hit or origin fetch",
    from:"HLS player",to:"CDN → object storage on miss",message:"GET /hls/clip/720p/seg000.m4s → cached segment or origin response.",
    state:"The player flow is the same; origin handles fewer repeated segment requests.",
    why:"One popular clip can cause many viewers to request the same opening segments.",
    build:"Use versioned, immutable segment URLs with long cache lifetimes. Cache playlists according to whether they can change; keep per-viewer tokens out of the cache key when the access design permits.",
    inside:"A cache miss still reaches origin. A CDN reduces repeated origin work but cannot fix a missing segment or unsupported codec.",
    failure:"If a mutable playlist is cached too long, it may point to old or missing files. Use versioned paths or deliberate invalidation.",
    rule:"The CDN changes where bytes come from, not the playback order.",source:"cache"
  },
  {
    name:"Recover a stall",title:"Handle a slow or missing segment without hiding it.",
    lead:"If a segment request times out, retry within a limit and try a lower quality at the same time position. If all variants fail, stop with a clear error and record the failed URL.",
    focus:["HLS player","CDN","Object storage","Viewer's browser"],signal:"Retry or fail clearly",
    from:"HLS player",to:"CDN or origin",message:"Retry segment; choose lower bitrate if bandwidth is the issue; report 404 or decode failure.",
    state:"Transient network trouble may recover. A missing published file remains a service error.",
    why:"A real player must distinguish slow delivery from a broken package so it can respond usefully.",
    build:"Log video ID, variant, segment, status, retry count, startup time, and stall duration. Alert on missing files and rising stall rates.",
    inside:"Lower bitrate helps when throughput is low; it cannot repair a 404 for every rendition or corrupt initialization data. Retry with backoff and a finite cap.",
    failure:"Infinite retry loops leave the viewer staring at a spinner. Give a retry control or a clear unavailable state after bounded attempts.",
    rule:"Measure the exact failing request; recover only when a valid alternative exists.",source:"hls"
  }
];
