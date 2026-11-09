(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- Lưu trữ an toàn ---------- */
  var store = {
    get: function (k, d) {
      try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* bỏ qua */ }
    }
  };

  var settings = Object.assign(
    { theme: null, saveHistory: true, autoPaste: false, reduce: false, api: "" },
    store.get("tiksave.settings", {})
  );
  var history = store.get("tiksave.history", []);
  var current = null;

  function saveSettings() { store.set("tiksave.settings", settings); }
  function saveHistory() { store.set("tiksave.history", history); updateCount(); }

  function apiBase() {
    var b = (settings.api || window.TIKSAVE_API || "").trim().replace(/\/+$/, "");
    return b;
  }

  /* ---------- Icon ---------- */
  function icons() {
    if (window.lucide && window.lucide.createIcons) {
      try { window.lucide.createIcons(); } catch (e) { /* bỏ qua */ }
    }
  }

  /* ---------- Giao diện sáng tối ---------- */
  function systemTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", t === "dark" ? "#070b1d" : "#f3f2fb");
    $$("[data-theme-set]").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-theme-set") === t); });
  }
  function setTheme(t) { settings.theme = t; saveSettings(); applyTheme(t); }

  /* ---------- Toast ---------- */
  function toast(msg, kind) {
    var box = $("#toasts");
    var el = document.createElement("div");
    el.className = "toast " + (kind || "ok");
    el.innerHTML = '<i data-lucide="' + (kind === "bad" ? "circle-alert" : "circle-check") + '"></i><span></span>';
    el.lastChild.textContent = msg;
    box.appendChild(el);
    icons();
    setTimeout(function () {
      el.style.transition = "opacity .3s, transform .3s";
      el.style.opacity = "0";
      el.style.transform = "translateY(10px)";
      setTimeout(function () { el.remove(); }, 320);
    }, 3200);
  }

  /* ---------- Định tuyến theo hash ---------- */
  var views = ["home", "history", "settings"];
  function route() {
    var name = (location.hash || "#home").slice(1);
    if (views.indexOf(name) < 0) name = "home";
    $$(".view").forEach(function (v) { v.hidden = v.getAttribute("data-view") !== name; });
    $$("[data-nav]").forEach(function (a) { a.classList.toggle("on", a.getAttribute("data-nav") === name); });
    if (name === "history") renderHistory();
    if (name === "settings") syncSettingsUI();
    window.scrollTo({ top: 0 });
    var active = $("#view-" + name);
    if (window.gsap && !settings.reduce && active) {
      gsap.fromTo(active.children, { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: .5, stagger: .06, ease: "power3.out", clearProps: "all" });
    }
  }

  /* ---------- Kiểm tra liên kết ---------- */
  function looksLikeTikTok(u) {
    try {
      var x = new URL(u);
      if (x.protocol !== "https:" && x.protocol !== "http:") return false;
      var h = x.hostname.toLowerCase();
      return h === "tiktok.com" || /\.tiktok\.com$/.test(h);
    } catch (e) { return false; }
  }
  function extractUrl(text) {
    var m = String(text || "").match(/https?:\/\/[^\s]+/i);
    return m ? m[0] : String(text || "").trim();
  }
  function videoId(u) {
    var m = String(u).match(/\/video\/(\d+)/);
    return m ? m[1] : "";
  }

  /* ---------- Gọi backend ---------- */
  function api(path, opts) {
    return fetch(apiBase() + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          var err = new Error(data.message || "Yêu cầu thất bại (" + r.status + ")");
          err.code = data.error || "http_" + r.status;
          throw err;
        }
        return data;
      });
    });
  }

  function showError(msg) {
    var e = $("#formError");
    e.textContent = msg;
    e.hidden = false;
    if (window.gsap && !settings.reduce) gsap.fromTo(e, { x: -8 }, { x: 0, duration: .5, ease: "elastic.out(1,.4)" });
  }
  function clearError() { $("#formError").hidden = true; }

  function setBusy(b) {
    var btn = $("#analyzeBtn");
    btn.disabled = b;
    $(".btn-label", btn).hidden = b;
    $(".btn-spin", btn).hidden = !b;
  }

  /* ---------- Phân tích ---------- */
  function analyze(e) {
    if (e) e.preventDefault();
    clearError();
    var url = extractUrl($("#urlInput").value);
    if (!url) { showError("Hãy dán liên kết video TikTok vào ô phía trên."); return; }
    if (!looksLikeTikTok(url)) { showError("Liên kết này không phải của TikTok. Hãy kiểm tra lại."); return; }
    $("#urlInput").value = url;
    var owner = $("#ownerCheck").checked;

    setBusy(true);
    api("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url, owner: owner })
    }).then(function (data) {
      current = { url: data.url || url, data: data, owner: owner };
      renderResult(current);
      if (settings.saveHistory) addHistory(data, current.url);
    }).catch(function (err) {
      $("#result").hidden = true;
      if (err instanceof TypeError) {
        showError("Không kết nối được máy chủ. Mở Cài đặt để kiểm tra địa chỉ backend.");
      } else {
        showError(err.message);
      }
    }).then(function () { setBusy(false); });
  }

  function renderResult(c) {
    var d = c.data;
    var box = $("#result");
    $("#resTitle").textContent = d.title || "Video TikTok";
    $("#resAuthor").textContent = d.author || "—";
    $("#resId").textContent = videoId(c.url) || "—";
    var img = $("#thumbImg");
    img.src = d.thumbnail ? apiBase() + "/api/thumb?url=" + encodeURIComponent(d.thumbnail) : "";
    img.alt = d.title ? "Ảnh bìa: " + d.title : "Ảnh bìa video";
    $("#openOriginal").href = c.url;

    var list = $("#dlList");
    list.innerHTML = "";
    var note = $("#dlNote");

    if (d.thumbnail) {
      var t = document.createElement("a");
      t.className = "btn btn-ghost";
      t.href = apiBase() + "/api/thumb?download=1&url=" + encodeURIComponent(d.thumbnail);
      t.innerHTML = '<i data-lucide="image-down"></i> Ảnh bìa';
      list.appendChild(t);
    }

    var items = d.downloads || [];
    if (items.length && c.owner) {
      items.forEach(function (q, i) {
        var a = document.createElement("a");
        a.className = "btn " + (i === 0 ? "btn-primary" : "btn-ghost");
        a.href = q.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.setAttribute("download", "");
        a.innerHTML = '<i data-lucide="download"></i><span></span>';
        a.lastChild.textContent = q.label + (q.noMark ? " · không logo" : "");
        list.insertBefore(a, list.firstChild && i === 0 ? list.firstChild : null);
      });
      note.textContent = "Tệp sẽ được tải trực tiếp từ nhà cung cấp. Chất lượng phụ thuộc bản gốc.";
    } else if (!c.owner) {
      note.textContent = "Tích ô xác nhận quyền sở hữu ở trên rồi phân tích lại để hiện các nút tải video.";
    } else if (d.downloadsEnabled === false) {
      note.textContent = "Máy chủ này chưa kết nối nhà cung cấp tải video. Xem README để cấu hình. Hiện bạn vẫn xem trước và lưu ảnh bìa được.";
    } else {
      note.textContent = "Nhà cung cấp không trả về bản tải cho video này.";
    }

    box.hidden = false;
    icons();
    if (window.gsap && !settings.reduce) {
      gsap.fromTo(box, { y: 30, opacity: 0, scale: .98 }, { y: 0, opacity: 1, scale: 1, duration: .7, ease: "power3.out", clearProps: "transform" });
      gsap.from($$(".meta div, .dl-list .btn, .result-actions .btn", box), { y: 12, opacity: 0, duration: .45, stagger: .05, delay: .2, ease: "power2.out", clearProps: "all" });
    }
    setTimeout(function () { box.scrollIntoView({ behavior: settings.reduce ? "auto" : "smooth", block: "start" }); }, 80);
  }

  /* ---------- Lịch sử ---------- */
  function addHistory(d, url) {
    history = history.filter(function (h) { return h.url !== url; });
    history.unshift({
      url: url,
      title: d.title || "Video TikTok",
      author: d.author || "",
      thumbnail: d.thumbnail || "",
      at: Date.now()
    });
    history = history.slice(0, 60);
    saveHistory();
  }
  function updateCount() {
    var c = $("#historyCount");
    c.textContent = history.length > 99 ? "99+" : String(history.length);
    c.hidden = history.length === 0;
  }
  function timeAgo(ts) {
    var s = Math.max(1, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return "Vừa xong";
    var m = Math.round(s / 60);
    if (m < 60) return m + " phút trước";
    var h = Math.round(m / 60);
    if (h < 24) return h + " giờ trước";
    var d = Math.round(h / 24);
    if (d < 30) return d + " ngày trước";
    return new Date(ts).toLocaleDateString("vi-VN");
  }
  function renderHistory() {
    var q = ($("#historySearch").value || "").trim().toLowerCase();
    var list = $("#historyList");
    list.innerHTML = "";
    var rows = history.filter(function (h) {
      return !q || (h.title + " " + h.author).toLowerCase().indexOf(q) >= 0;
    });
    $("#historyEmpty").hidden = history.length > 0;
    $("#clearHistory").hidden = history.length === 0;
    $(".search").hidden = history.length === 0;

    rows.forEach(function (h) {
      var li = document.createElement("li");
      li.className = "h-item glass";
      var th = document.createElement("div");
      th.className = "h-thumb";
      if (h.thumbnail) {
        var im = document.createElement("img");
        im.alt = "";
        im.loading = "lazy";
        im.referrerPolicy = "no-referrer";
        im.src = apiBase() + "/api/thumb?url=" + encodeURIComponent(h.thumbnail);
        th.appendChild(im);
      }
      var main = document.createElement("div");
      main.className = "h-main";
      var t = document.createElement("h3");
      t.textContent = h.title;
      var p = document.createElement("p");
      p.textContent = (h.author ? h.author + " · " : "") + timeAgo(h.at);
      main.appendChild(t);
      main.appendChild(p);

      var act = document.createElement("div");
      act.className = "h-act";
      act.innerHTML =
        '<button type="button" class="again" aria-label="Phân tích lại"><i data-lucide="rotate-cw"></i></button>' +
        '<button type="button" class="copy" aria-label="Sao chép liên kết"><i data-lucide="copy"></i></button>' +
        '<a class="open" target="_blank" rel="noopener noreferrer" aria-label="Mở trên TikTok"><i data-lucide="external-link"></i></a>' +
        '<button type="button" class="del" aria-label="Xóa mục này"><i data-lucide="trash-2"></i></button>';
      $(".open", act).href = h.url;
      $(".again", act).onclick = function () {
        $("#urlInput").value = h.url;
        location.hash = "#home";
        $("#urlInput").focus({ preventScroll: true });
      };
      $(".copy", act).onclick = function () { copy(h.url); };
      $(".del", act).onclick = function () {
        history = history.filter(function (x) { return x.url !== h.url; });
        saveHistory();
        renderHistory();
        toast("Đã xóa khỏi lịch sử");
      };

      li.appendChild(th);
      li.appendChild(main);
      li.appendChild(act);
      list.appendChild(li);
    });
    icons();
    if (window.gsap && !settings.reduce) {
      gsap.from($$(".h-item"), { y: 14, opacity: 0, duration: .4, stagger: .04, ease: "power2.out", clearProps: "all" });
    }
  }

  var confirmClear = false;
  function clearAll() {
    var b = $("#clearHistory");
    if (!confirmClear) {
      confirmClear = true;
      b.innerHTML = '<i data-lucide="triangle-alert"></i> Nhấn lần nữa để xóa';
      icons();
      setTimeout(function () {
        confirmClear = false;
        b.innerHTML = '<i data-lucide="trash-2"></i> Xóa tất cả';
        icons();
      }, 3000);
      return;
    }
    confirmClear = false;
    history = [];
    saveHistory();
    renderHistory();
    b.innerHTML = '<i data-lucide="trash-2"></i> Xóa tất cả';
    icons();
    toast("Đã xóa toàn bộ lịch sử");
  }

  /* ---------- Sao chép ---------- */
  function copy(text) {
    var done = function () { toast("Đã sao chép liên kết"); };
    var fallback = function () {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast("Không sao chép được", "bad"); }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else { fallback(); }
  }

  /* ---------- Dán ---------- */
  function paste() {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      toast("Trình duyệt không cho đọc bộ nhớ tạm. Hãy dán thủ công.", "bad");
      $("#urlInput").focus();
      return;
    }
    navigator.clipboard.readText().then(function (t) {
      var u = extractUrl(t);
      if (looksLikeTikTok(u)) {
        $("#urlInput").value = u;
        clearError();
        toast("Đã dán liên kết");
      } else {
        toast("Bộ nhớ tạm không có liên kết TikTok", "bad");
      }
    }, function () {
      toast("Chưa được phép đọc bộ nhớ tạm. Hãy dán thủ công.", "bad");
      $("#urlInput").focus();
    });
  }
  function autoPaste() {
    if (!settings.autoPaste || !navigator.clipboard || !navigator.clipboard.readText) return;
    navigator.clipboard.readText().then(function (t) {
      var u = extractUrl(t);
      if (looksLikeTikTok(u) && !$("#urlInput").value) $("#urlInput").value = u;
    }, function () { /* không có quyền */ });
  }

  /* ---------- Cài đặt ---------- */
  function syncSettingsUI() {
    $("#setHistory").checked = !!settings.saveHistory;
    $("#setAutoPaste").checked = !!settings.autoPaste;
    $("#setReduce").checked = !!settings.reduce;
    $("#setApi").value = settings.api || "";
    $$("[data-theme-set]").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-theme-set") === document.documentElement.getAttribute("data-theme"));
    });
  }
  function testApi() {
    var out = $("#apiStatus");
    settings.api = $("#setApi").value.trim();
    saveSettings();
    out.className = "api-status";
    out.textContent = "Đang kiểm tra...";
    api("/api/health").then(function (d) {
      out.className = "api-status ok";
      out.textContent = "Kết nối tốt. Tải video: " + (d.downloads ? "đã bật" : "chưa cấu hình");
    }).catch(function () {
      out.className = "api-status bad";
      out.textContent = "Không kết nối được. Kiểm tra địa chỉ và CORS.";
    });
  }

  /* ---------- Chuyển động ---------- */
  function introMotion() {
    if (!window.gsap || settings.reduce) return;
    var tl = gsap.timeline({ defaults: { ease: "power3.out" } });
    tl.from(".topbar-in", { y: -30, opacity: 0, duration: .6 })
      .from(".hero .eyebrow", { y: 16, opacity: 0, duration: .5 }, "-=.3")
      .from(".hero-title .w", { yPercent: 70, opacity: 0, rotate: 3, duration: .7, stagger: .07 }, "-=.3")
      .from(".hero-sub, .rotator", { y: 14, opacity: 0, duration: .5, stagger: .1 }, "-=.35")
      .from(".analyzer", { y: 30, opacity: 0, duration: .7 }, "-=.3")
      .from(".feature, .steps li", { y: 24, opacity: 0, duration: .5, stagger: .06, clearProps: "all" }, "-=.2");

    gsap.to(".orb-a", { x: 60, y: 40, duration: 14, repeat: -1, yoyo: true, ease: "sine.inOut" });
    gsap.to(".orb-b", { x: -70, y: -50, duration: 17, repeat: -1, yoyo: true, ease: "sine.inOut" });
    gsap.to(".orb-c", { x: -40, y: 60, duration: 12, repeat: -1, yoyo: true, ease: "sine.inOut" });
  }

  var phrases = [
    "Mobile first, mượt trên Android",
    "Dán liên kết, thấy ngay video",
    "Lịch sử chỉ lưu trên máy bạn",
    "Chọn chất lượng 1080p, 720p, 480p"
  ];
  function rotator() {
    var el = $("#rotator");
    var i = 0;
    setInterval(function () {
      if (document.hidden) return;
      i = (i + 1) % phrases.length;
      if (window.gsap && !settings.reduce) {
        gsap.to(el, { opacity: 0, y: -8, duration: .25, onComplete: function () {
          el.textContent = phrases[i];
          gsap.fromTo(el, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: .3 });
        } });
      } else { el.textContent = phrases[i]; }
    }, 3200);
  }

  /* ---------- Khởi động ---------- */
  function init() {
    applyTheme(settings.theme || systemTheme());
    if (settings.reduce) document.documentElement.classList.add("reduce");
    $("#year").textContent = new Date().getFullYear();
    updateCount();

    $("#themeBtn").onclick = function () {
      setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
    };
    $$("[data-theme-set]").forEach(function (b) {
      b.onclick = function () { setTheme(b.getAttribute("data-theme-set")); };
    });

    $("#analyzeForm").addEventListener("submit", analyze);
    $("#pasteBtn").onclick = paste;
    $("#copyLinkBtn").onclick = function () { if (current) copy(current.url); };
    $("#urlInput").addEventListener("input", clearError);
    $("#historySearch").addEventListener("input", renderHistory);
    $("#clearHistory").onclick = clearAll;

    $("#setHistory").onchange = function (e) { settings.saveHistory = e.target.checked; saveSettings(); };
    $("#setAutoPaste").onchange = function (e) { settings.autoPaste = e.target.checked; saveSettings(); if (e.target.checked) autoPaste(); };
    $("#setReduce").onchange = function (e) {
      settings.reduce = e.target.checked;
      document.documentElement.classList.toggle("reduce", settings.reduce);
      saveSettings();
    };
    $("#setApi").onchange = function (e) { settings.api = e.target.value.trim(); saveSettings(); };
    $("#testApi").onclick = testApi;

    window.addEventListener("hashchange", route);
    icons();
    route();
    introMotion();
    rotator();
    autoPaste();

    if ("serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register("sw.js").catch(function () { /* bỏ qua */ });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
