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
    '<div style="display:flex;gap:6px;padding:8px;border-top:1px solid #e2e8f0">' +
    '<input id="wc-input" type="text" placeholder="আপনার বার্তা লিখুন..." style="flex:1;border:1px solid #cbd5e1;border-radius:10px;padding:8px 10px;font-size:13px;outline:none"/>' +
    '<button id="wc-send" style="border:none;border-radius:10px;padding:8px 14px;color:#fff;font-weight:600;cursor:pointer;background:' + color + '">পাঠান</button></div>';
  document.body.appendChild(panel);

  var msgsEl = panel.querySelector("#wc-msgs");
  var input = panel.querySelector("#wc-input");

  function bubble(m) {
    if (seen[m.id]) return;
    seen[m.id] = true;
    var row = document.createElement("div");
    var mine = m.direction === "in"; // visitor's own messages arrive as "in"
    row.style.cssText = "max-width:82%;padding:7px 10px;border-radius:12px;font-size:13px;line-height:1.45;white-space:pre-wrap;align-self:" + (mine ? "flex-end" : "flex-start") + ";background:" + (mine ? color : "#fff") + ";color:" + (mine ? "#fff" : "#0f172a") + (mine ? "" : ";border:1px solid #e2e8f0");
    row.textContent = m.content || "";
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

  function start() {
    if (token) { fetchMessages(); return; }
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
      })
      .catch(function () { systemLine("দুঃখিত, চ্যাট এখন উপলব্ধ নয়।"); });
  }

  function send() {
    var text = input.value.trim();
    if (!text || !token) return;
    input.value = "";
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
      pollTimer = setInterval(fetchMessages, 4000);
      input.focus();
    } else if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  });
  panel.querySelector("#wc-send").addEventListener("click", send);
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") send(); });
})();
