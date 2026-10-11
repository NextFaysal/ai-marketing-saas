/* Qosprey Live Chat widget. Embed:
 * <script src="https://YOUR-APP/chat-widget.js" data-key="wc_..." async></script>
 * Talks to the public chat API on the same origin as this script
 * (override with data-api="https://your-app"). No cookies are set;
 * the visitor id + session token live in localStorage on the
 * merchant's own domain.
 */
(function () {
  var script = document.currentScript;
  var key = script.getAttribute("data-key");
  if (!key) return;
  var apiBase = script.getAttribute("data-api") || script.src.split("/chat-widget.js")[0];

  var visitorId = localStorage.getItem("wc_visitor_id");
  if (!visitorId) {
    visitorId = "v-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("wc_visitor_id", visitorId);
  }
  var token = localStorage.getItem("wc_token_" + key) || null;
  var color = "#6d28d9";
  var open = false;
  var pollTimer = null;
  var presenceTimer = null; // P3: visitor presence heartbeat (25s)
  var typingFlag = false; // P3: we have told the agent side we are typing
  var typingDebounce = null;
  var typingHideTimer = null;
  var es = null; // Milestone 66: realtime stream (polling is the fallback)
  var seen = {};

  var btn = document.createElement("button");
  btn.textContent = "💬";
  btn.setAttribute("aria-label", "Chat with us");
  btn.style.cssText = "position:fixed;right:18px;bottom:18px;width:56px;height:56px;border-radius:50%;border:none;background:" + color + ";color:#fff;font-size:24px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25);z-index:99998";
  document.body.appendChild(btn);

  var panel = document.createElement("div");
  panel.style.cssText = "display:none;position:fixed;right:18px;bottom:84px;width:min(92vw,360px);height:480px;max-height:70vh;background:#fff;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.28);z-index:99999;flex-direction:column;overflow:hidden;font-family:system-ui,-apple-system,'Segoe UI',sans-serif";
  panel.innerHTML =
    '<div id="wc-head" style="padding:12px 14px;color:#fff;font-weight:700;font-size:14px;background:' + color + '">Live Chat</div>' +
    '<div id="wc-msgs" style="flex:1;overflow-y:auto;padding:10px;background:#f8fafc;display:flex;flex-direction:column;gap:6px"></div>' +
    '<div id="wc-typing" style="display:none;padding:4px 12px;font-size:11px;color:#64748b;background:#f8fafc;text-align:left">টাইপ করছেন…</div>' +
    '<div style="display:flex;gap:6px;padding:8px;border-top:1px solid #e2e8f0">' +
    '<input id="wc-input" type="text" placeholder="আপনার বার্তা লিখুন..." style="flex:1;border:1px solid #cbd5e1;border-radius:10px;padding:8px 10px;font-size:13px;outline:none"/>' +
    '<button id="wc-send" style="border:none;border-radius:10px;padding:8px 14px;color:#fff;font-weight:600;cursor:pointer;background:' + color + '">পাঠান</button></div>';
  document.body.appendChild(panel);

  var msgsEl = panel.querySelector("#wc-msgs");
  var input = panel.querySelector("#wc-input");
  var typingEl = panel.querySelector("#wc-typing");

  /* P3: presence heartbeat + typing cues. Fire-and-forget: a
   * failed presence POST must never disturb the chat itself. */
  function postPresence(typing) {
    if (!token) return;
    var body = { token: token };
    if (typeof typing === "boolean") body.typing = typing;
    fetch(apiBase + "/public/chat/" + key + "/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(function () { /* presence is best-effort */ });
  }
  function startPresence() {
    stopPresence();
    if (!open || !token) return;
    postPresence();
    presenceTimer = setInterval(postPresence, 25000);
  }
  function stopPresence() {
    if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; }
  }
  function setTypingOff() {
    if (typingDebounce) { clearTimeout(typingDebounce); typingDebounce = null; }
    if (typingFlag) { typingFlag = false; postPresence(false); }
  }
  function showAgentTyping(show) {
    if (!typingEl) return;
    if (typingHideTimer) { clearTimeout(typingHideTimer); typingHideTimer = null; }
    if (show) {
      typingEl.style.display = "block";
      typingHideTimer = setTimeout(function () { typingEl.style.display = "none"; }, 4000);
    } else {
      typingEl.style.display = "none";
    }
  }

  function bubble(m) {
    if (seen[m.id]) return;
    seen[m.id] = true;
    var row = document.createElement("div");
    var mine = m.direction === "in"; // visitor's own messages arrive as "in"
    row.style.cssText = "max-width:82%;padding:7px 10px;border-radius:12px;font-size:13px;line-height:1.45;white-space:pre-wrap;align-self:" + (mine ? "flex-end" : "flex-start") + ";background:" + (mine ? color : "#fff") + ";color:" + (mine ? "#fff" : "#0f172a") + (mine ? "" : ";border:1px solid #e2e8f0");
    // Inbox Next-Gen P1: agent-sent media (image / voice / video /
    // file). The URL is derived from the session credentials the
    // same way the poll/stream calls are — the server only serves
    // bytes for THIS session's own conversation. Elements are built
    // with createElement + property assignment (never innerHTML),
    // so message text stays inert.
    var mediaPath = m.mediaUrl || null;
    if (!mediaPath && token && (m.type === "image" || m.type === "audio" || m.type === "video" || m.type === "document")) {
      mediaPath = "/public/chat/" + key + "/messages/" + m.id + "/media?token=" + encodeURIComponent(token);
    }
    if (mediaPath) {
      var src = apiBase + mediaPath;
      var mediaEl = null;
      if (m.type === "image") {
        mediaEl = document.createElement("img");
        mediaEl.src = src;
        mediaEl.alt = m.content || "ছবি";
        mediaEl.style.cssText = "max-width:100%;border-radius:8px;display:block;margin-bottom:4px";
      } else if (m.type === "audio") {
        mediaEl = document.createElement("audio");
        mediaEl.controls = true;
        mediaEl.src = src;
        mediaEl.style.cssText = "max-width:100%;display:block;margin-bottom:4px";
      } else if (m.type === "video") {
        mediaEl = document.createElement("video");
        mediaEl.controls = true;
        mediaEl.src = src;
        mediaEl.style.cssText = "max-width:100%;border-radius:8px;display:block;margin-bottom:4px";
      } else {
        mediaEl = document.createElement("a");
        mediaEl.href = src;
        mediaEl.target = "_blank";
        mediaEl.rel = "noopener";
        mediaEl.textContent = "📎 " + (m.content || "ফাইল ডাউনলোড করুন");
        mediaEl.style.cssText = "display:block;margin-bottom:4px;color:inherit;text-decoration:underline";
      }
      if (mediaEl) row.appendChild(mediaEl);
    }
    if (m.content && !(mediaPath && m.type === "document")) {
      var caption = document.createElement("span");
      caption.textContent = m.content;
      row.appendChild(caption);
    }
    // Inbox Next-Gen P2: product showcase cards. The server marks
    // composed product-card image messages with `product` (name +
    // formatted price parsed from the card caption — the visitor
    // projection carries nothing else). Rendered as a card with a
    // one-tap order button that sends the order intent as a normal
    // visitor message, which the chat order flow picks up.
    if (m.product && mediaPath && m.type === "image") {
      row.style.cssText += ";background:#fff;border:1px solid #e2e8f0;box-shadow:0 1px 3px rgba(15,23,42,.08)";
      var orderBtn = document.createElement("button");
      orderBtn.type = "button";
      orderBtn.textContent = "🛒 অর্ডার করুন";
      orderBtn.style.cssText = "display:block;width:100%;margin-top:7px;padding:7px 10px;border:0;border-radius:8px;background:" + color + ";color:#fff;font-size:13px;font-weight:700;cursor:pointer";
      orderBtn.addEventListener("click", function () {
        sendText("আমি \"" + m.product.name + "\" অর্ডার করতে চাই");
      });
      row.appendChild(orderBtn);
    }
    msgsEl.appendChild(row);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function systemLine(text) {
    var row = document.createElement("div");
    row.style.cssText = "align-self:center;font-size:11px;color:#64748b;background:#e2e8f0;border-radius:999px;padding:2px 10px";
    row.textContent = text;
    msgsEl.appendChild(row);
  }

  function fetchMessages() {
    if (!token) return;
    fetch(apiBase + "/public/chat/" + key + "/messages?token=" + encodeURIComponent(token))
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) { (rows || []).forEach(bubble); })
      .catch(function () { /* transient: keep polling */ });
  }

  function startPolling() {
    if (!pollTimer && open) pollTimer = setInterval(fetchMessages, 4000);
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  /* Realtime (M66): subscribe to this conversation's stream.
   * Any failure — old server, blocked EventSource, stream
   * closed — quietly degrades to the 4s polling below. */
  function connectStream() {
    if (!token || es || typeof EventSource === "undefined") { startPolling(); return; }
    try {
      es = new EventSource(apiBase + "/public/chat/" + key + "/stream?token=" + encodeURIComponent(token));
      es.onopen = function () { stopPolling(); };
      es.onmessage = function (ev) {
        try {
          var d = JSON.parse(ev.data);
          if (d && d.type === "message.created" && d.message) bubble(d.message);
          if (d && d.type === "typing") showAgentTyping(Boolean(d.typing));
        } catch (e) { /* a bad frame never breaks the widget */ }
      };
      es.onerror = function () {
        if (es && es.readyState === 2) { es.close(); es = null; startPolling(); }
      };
    } catch (e) { es = null; startPolling(); }
  }
  function closeStream() {
    if (es) { try { es.close(); } catch (e) { /* noop */ } es = null; }
  }

  function start() {
    if (token) { fetchMessages(); connectStream(); startPresence(); return; }
    fetch(apiBase + "/public/chat/" + key + "/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitorId: visitorId }),
    })
      .then(function (r) { if (!r.ok) throw new Error("start failed"); return r.json(); })
      .then(function (s) {
        token = s.token;
        localStorage.setItem("wc_token_" + key, token);
        if (s.color) {
          color = s.color;
          btn.style.background = color;
          panel.querySelector("#wc-head").style.background = color;
          panel.querySelector("#wc-send").style.background = color;
        }
        panel.querySelector("#wc-head").textContent = s.siteName ? s.siteName + " — Live Chat" : "Live Chat";
        if (s.greeting) systemLine(s.greeting);
        fetchMessages();
        connectStream();
        startPresence();
      })
      .catch(function () { systemLine("দুঃখিত, চ্যাট এখন উপলব্ধ নয়।"); });
  }

  function send() {
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    setTypingOff();
    sendText(text);
  }

  function sendText(text) {
    if (!text || !token) return;
    fetch(apiBase + "/public/chat/" + key + "/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token, text: text }),
    })
      .then(function (r) { if (!r.ok) throw new Error("send failed"); fetchMessages(); })
      .catch(function () { systemLine("বার্তা পাঠানো যায়নি, আবার চেষ্টা করুন।"); });
  }

  btn.addEventListener("click", function () {
    open = !open;
    panel.style.display = open ? "flex" : "none";
    if (open) {
      start();
      startPolling(); // connectStream stops this once the stream is live
      input.focus();
    } else {
      stopPolling();
      closeStream();
      stopPresence();
      setTypingOff();
      showAgentTyping(false);
    }
  });
  panel.querySelector("#wc-send").addEventListener("click", send);
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") send(); });
  input.addEventListener("input", function () {
    if (!token) return;
    if (input.value && !typingFlag) { typingFlag = true; postPresence(true); }
    if (typingDebounce) clearTimeout(typingDebounce);
    typingDebounce = setTimeout(function () {
      typingDebounce = null;
      if (typingFlag) { typingFlag = false; postPresence(false); }
    }, 2500);
  });
})();
