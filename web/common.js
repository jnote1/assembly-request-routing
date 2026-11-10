(function initializeCommon(root) {
  "use strict";

  const API_URL = "../api/app";

  function injectBaseStyles() {
    if (document.getElementById("common-styles")) return;
    const style = document.createElement("style");
    style.id = "common-styles";
    style.textContent = `
      :root{--navy:#10243f;--navy-2:#18375d;--blue:#246bfd;--sky:#eaf2ff;--ink:#172033;
        --muted:#667085;--line:#dce3ed;--paper:#f5f7fb;--white:#fff;--good:#137a57;--warn:#b45309;
        --shadow:0 16px 40px rgba(16,36,63,.09);font-family:Pretendard,"Noto Sans KR",system-ui,sans-serif}
      *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink)}
      button,input,select{font:inherit}a{color:inherit}.app-header{position:sticky;top:0;z-index:20;background:rgba(16,36,63,.96);
        color:#fff;border-bottom:1px solid rgba(255,255,255,.12);backdrop-filter:blur(14px)}
      .nav-wrap{max-width:1440px;margin:auto;padding:0 24px;display:flex;align-items:center;min-height:68px;gap:28px}
      .brand{font-weight:850;letter-spacing:-.04em;white-space:nowrap}.brand small{display:block;font-size:11px;font-weight:600;
        color:#a9c7f5;letter-spacing:.08em;margin-bottom:2px}.top-nav{display:flex;gap:5px;align-items:center;flex-wrap:wrap}
      .top-nav a,.top-nav button{border:0;background:transparent;color:#ced9e9;text-decoration:none;padding:10px 13px;
        border-radius:10px;font-weight:720;font-size:14px;cursor:pointer}.top-nav a:hover,.top-nav a.active{color:#fff;background:rgba(255,255,255,.1)}
      .top-nav button:disabled{opacity:.42;cursor:not-allowed}.nav-spacer{flex:1}.local-badge{font-size:12px;padding:7px 10px;
        border:1px solid rgba(255,255,255,.2);border-radius:999px;color:#cde0ff;white-space:nowrap}
      .page-shell{max-width:1440px;margin:0 auto;padding:36px 24px 64px}.eyebrow{color:var(--blue);font-weight:850;font-size:12px;
        letter-spacing:.12em;text-transform:uppercase}.page-title{margin:8px 0 10px;font-size:clamp(30px,4vw,48px);letter-spacing:-.055em;line-height:1.08}
      .page-lead{color:var(--muted);font-size:16px;line-height:1.75;max-width:800px}.panel{background:var(--white);border:1px solid var(--line);
        border-radius:20px;box-shadow:var(--shadow)}.btn{position:relative;overflow:hidden;border:0;border-radius:12px;padding:11px 16px;
        font-weight:800;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;text-decoration:none;
        transition:transform .35s cubic-bezier(.34,1.56,.64,1),background .2s}.btn:hover{transform:translateY(-2px)}
      .btn:disabled{opacity:.45;cursor:not-allowed;transform:none}.btn-primary{background:var(--blue);color:#fff}.btn-secondary{background:var(--sky);color:#184b9b}
      .btn-ghost{background:#fff;border:1px solid var(--line);color:var(--navy)}.ripple-dot{position:absolute;width:18px;height:18px;
        border-radius:50%;background:rgba(255,255,255,.45);transform:translate(-50%,-50%) scale(0);pointer-events:none;animation:ripple .55s ease-out}
      @keyframes ripple{to{transform:translate(-50%,-50%) scale(12);opacity:0}}[data-reveal]{opacity:0;transform:translateY(22px);
        transition:opacity .58s cubic-bezier(.2,.7,.2,1),transform .58s cubic-bezier(.2,.7,.2,1)}[data-reveal].show{opacity:1;transform:none}
      .toast{position:fixed;right:24px;bottom:24px;z-index:50;background:var(--navy);color:#fff;padding:14px 17px;border-radius:13px;
        box-shadow:0 18px 44px rgba(0,0,0,.22);opacity:0;transform:translateY(12px);transition:.25s;max-width:420px}.toast.show{opacity:1;transform:none}
      .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
      @media(max-width:760px){.nav-wrap{align-items:flex-start;padding-block:14px;gap:12px;flex-wrap:wrap}.top-nav{order:3;width:100%}.local-badge{display:none}.page-shell{padding:26px 15px 48px}}
      @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}
        [data-reveal]{opacity:1;transform:none}.btn:hover{transform:none}}
    `;
    document.head.appendChild(style);
  }

  function mountNavigation(active = "") {
    injectBaseStyles();
    const header = document.querySelector("[data-app-header]");
    if (!header) return;
    header.className = "app-header";
    header.innerHTML = `
      <div class="nav-wrap">
        <div class="brand"><small>A부 국회 업무</small>요구자료 배분</div>
        <nav class="top-nav" aria-label="주요 화면">
          <a href="./index.html" class="${active === "home" ? "active" : ""}">시작 화면</a>
          <a href="./assign.html" class="${active === "assign" ? "active" : ""}">배분</a>
          <a href="./dept.html" class="${active === "dept" ? "active" : ""}">현업 회신</a>
          <button type="button" disabled title="S8에서 제공 예정">취합</button>
        </nav>
        <span class="nav-spacer"></span><span class="local-badge">공유 저장소 연결</span>
      </div>`;
  }

  function parseCsv(text) {
    const source = text.replace(/^\uFEFF/, "");
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];
      if (quoted) {
        if (char === '"' && source[i + 1] === '"') { field += '"'; i += 1; }
        else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") { row.push(field); field = ""; }
      else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
      else field += char;
    }
    if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
    if (quoted) throw new Error("CSV 따옴표가 닫히지 않았습니다.");
    const valid = rows.filter((current) => current.some((value) => value.trim()));
    if (!valid.length) return [];
    const headers = valid.shift().map((value) => value.trim());
    return valid.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  }

  async function loadCsv(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`${url}을(를) 읽지 못했습니다 (${response.status}).`);
    return parseCsv(await response.text());
  }

  async function readCsvFile(file) { return parseCsv(await file.text()); }
  async function fetchCases() {
    const response = await fetch(API_URL, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `공유 저장소를 읽지 못했습니다 (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    if (!Array.isArray(body)) throw new Error("공유 저장소 응답 형식이 올바르지 않습니다.");
    return body;
  }

  async function postAction(action) {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `저장하지 못했습니다 (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return body;
  }
  function makeId() { return crypto.randomUUID?.() ?? `item-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function escapeHtml(value) { const node = document.createElement("div"); node.textContent = String(value ?? ""); return node.innerHTML; }
  function showToast(message) {
    let toast = document.querySelector(".toast");
    if (!toast) { toast = document.createElement("div"); toast.className = "toast"; toast.setAttribute("role", "status"); document.body.appendChild(toast); }
    toast.textContent = message; toast.classList.add("show"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function initEffects() {
    injectBaseStyles();
    const reduce = matchMedia("(prefers-reduced-motion:reduce)").matches;
    if (reduce) document.querySelectorAll("[data-reveal]").forEach((element) => element.classList.add("show"));
    else {
      const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
        if (!entry.isIntersecting) return; entry.target.classList.add("show"); observer.unobserve(entry.target);
      }), { threshold: .12 });
      document.querySelectorAll("[data-reveal]").forEach((element) => observer.observe(element));
    }
    document.addEventListener("click", (event) => {
      const button = event.target.closest(".btn"); if (!button || button.disabled || reduce) return;
      const rect = button.getBoundingClientRect(), dot = document.createElement("span"); dot.className = "ripple-dot";
      dot.style.left = `${event.clientX - rect.left}px`; dot.style.top = `${event.clientY - rect.top}px`; button.appendChild(dot);
      dot.addEventListener("animationend", () => dot.remove(), { once: true });
    });
  }

  root.Common = { API_URL, mountNavigation, parseCsv, loadCsv, readCsvFile, fetchCases, postAction, makeId, escapeHtml, showToast, initEffects };
})(globalThis);
