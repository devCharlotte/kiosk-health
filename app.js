/*
 * 건강관리실 안내 키오스크
 * 화면 구성과 동작을 담당합니다. 안내 내용은 config.js에서 수정합니다.
 *
 * 개인정보 처리 원칙
 *  - 방문자가 고른 내용은 메모리에만 잠시 있고, 저장(localStorage, 쿠키 등)하거나 전송하지 않습니다.
 *  - 처음 화면으로 돌아가면 선택한 내용과 입력한 학번(교번)은 모두 지워집니다.
 *  - 직원 확인 화면의 QR코드는 화면에 그려지기만 하며, 직원이 휴대전화로 찍어 내용을 확인합니다.
 */

/*
 * Future Server Integration
 *
 * TODO:
 * - 방문자 접수정보 저장 API
 * - 접수번호 및 대기번호 발급
 * - 실시간 대기 현황 조회
 * - 접수 상태 변경 및 호출
 * - 개인정보 보안 및 인증 체계
 *
 * 현재 버전에서는 서버 연동 기능을 사용하지 않습니다.
 *
 * 연결할 때 참고할 위치
 *  1) finishFlow()      : 직원 확인 화면으로 넘어가기 직전. 여기서 접수 내용을 전송합니다.
 *  2) renderSlip()      : 발급받은 접수번호와 대기 순번을 표시할 자리입니다.
 *  3) renderHome()      : 현재 대기 인원을 보여 줄 자리입니다.
 *
 *  예시 (사용하지 않음)
 *  async function submitVisit(payload) {
 *    // payload: { purpose, answers, visitorType, createdAt }
 *    // 이름, 학번, 연락처 등 식별 정보는 기관의 개인정보 처리 방침이 확정된 뒤에만 받습니다.
 *    // const res = await fetch(API_BASE + '/visits', { method: 'POST', ... });
 *    // return res.json(); // { ticketNo, waitingCount }
 *  }
 *  async function getQueueStatus() {
 *    // 대기 순번은 반드시 서버에서 발급합니다. 브라우저에서 순번을 만들지 않습니다.
 *  }
 *
 *  주의: 이 사이트는 누구나 내려받을 수 있는 정적 파일입니다. API 키나 비밀번호를 코드에 넣지 마세요.
 */

(function () {
  'use strict';

  const C = window.KIOSK_CONFIG || {};
  const F = C.facility || {};
  const H = C.hours || {};
  const K = Object.assign({
    idleSeconds: 90,
    idleWarningSeconds: 15,
    summarySeconds: 60,
    askVisitorType: true,
    visitorTypes: ['학생', '교직원', '기타'],
    slipQr: true,
    maskIdOnScreen: true,
    keepScreenOn: true,
    fullscreenOnTouch: true,
    allowOpenLinksOnDevice: true
  }, C.kiosk || {});

  const app = document.getElementById('app');
  const layer = document.getElementById('layer');

  /* ── 도구 ─────────────────────────────────────────── */

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const list = (v) => (Array.isArray(v) ? v : []);
  const safeUrl = (v) => {
    if (!v) return '';
    try {
      const u = new URL(v);
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
    } catch (e) { return ''; }
  };
  const pad = (n) => String(n).padStart(2, '0');
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const toMin = (hhmm) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDate = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  const md = (d) => `${d.getMonth() + 1}월 ${d.getDate()}일(${DOW[d.getDay()]})`;
  const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const VT = list(K.visitorTypes).map((v) => (typeof v === 'string' ? { label: v } : v)).filter((v) => v && v.label);
  const vtOf = (i) => VT[i] || null;
  const needsId = (v) => !!(v && v.idLabel);
  const idMin = (v) => Math.max(1, Number(v.minLength) || 4);
  const idMax = (v) => Math.max(idMin(v), Number(v.maxLength) || 12);

  // 화면 확인용: 주소 끝에 ?now=2026-10-23T12:30 을 붙이면 그 시각 기준으로 표시됩니다.
  const timeOffset = (() => {
    const p = new URLSearchParams(location.search).get('now');
    const t = p ? new Date(p).getTime() : NaN;
    return Number.isFinite(t) ? t - Date.now() : 0;
  })();
  const now = () => new Date(Date.now() + timeOffset);

  const ICON = {
    chev: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    mark: '<svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#1d5a50"/><path d="M26 14h12v12h12v12H38v12H26V38H14V26h12z" fill="#fff"/></svg>'
  };

  /* ── 운영시간 ─────────────────────────────────────── */

  function hoursFor(date) {
    const key = ymd(date);
    if (list(H.closedDates).includes(key)) return null;
    const sp = list(H.special).find((s) => s.from <= key && key <= s.to);
    if (sp && sp.closed) return null;
    const days = list(H.weekdays).length ? H.weekdays : [1, 2, 3, 4, 5];
    if (!days.includes(date.getDay())) return null;
    const open = toMin((sp && sp.open) || H.open || '09:00');
    const close = toMin((sp && sp.close) || H.close || '17:00');
    const lunch = H.lunch && toMin(H.lunch.start) != null && toMin(H.lunch.end) != null
      ? { start: toMin(H.lunch.start), end: toMin(H.lunch.end), text: `${H.lunch.start}-${H.lunch.end}` }
      : null;
    return {
      open, close, lunch,
      openText: (sp && sp.open) || H.open || '09:00',
      closeText: (sp && sp.close) || H.close || '17:00'
    };
  }

  function nextOpening(from) {
    for (let i = 1; i <= 21; i += 1) {
      const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
      const h = hoursFor(d);
      if (h) return { date: d, h, tomorrow: i === 1 };
    }
    return null;
  }

  // state: open | lunch | before | after | holiday
  function hoursStatus() {
    const n = now();
    const h = hoursFor(n);
    const t = n.getHours() * 60 + n.getMinutes();
    const nextText = () => {
      const nx = nextOpening(n);
      if (!nx) return '';
      return nx.tomorrow ? `내일 ${nx.h.openText}` : `${md(nx.date)} ${nx.h.openText}`;
    };
    if (!h) return { state: 'holiday', label: '휴무일', h: null, next: nextText() };
    if (t < h.open) return { state: 'before', label: '운영 전', h, next: `오늘 ${h.openText}` };
    if (t >= h.close) return { state: 'after', label: '운영 종료', h, next: nextText() };
    if (h.lunch && t >= h.lunch.start && t < h.lunch.end) {
      return { state: 'lunch', label: '점심시간', h, next: `오늘 ${H.lunch.end}` };
    }
    return { state: 'open', label: '운영 중', h, next: '' };
  }

  function weekdayText() {
    const days = list(H.weekdays).length ? H.weekdays.slice().sort() : [1, 2, 3, 4, 5];
    const isWeekdays = days.join() === '1,2,3,4,5';
    const offDays = [1, 2, 3, 4, 5, 6, 0].filter((d) => !days.includes(d)).map((d) => `${DOW[d]}요일`);
    return {
      open: isWeekdays ? '평일' : days.map((d) => DOW[d]).join(', '),
      off: offDays.length ? `${offDays.join(', ')}, 공휴일` : '공휴일'
    };
  }

  /* ── 상태 ─────────────────────────────────────────── */

  let session;
  const ui = { overlay: null, programTab: 'now' };
  const idle = { deadline: 0, timer: null };
  let lastHoursState = '';

  function newSession() {
    session = {
      id: Math.random().toString(36).slice(2),
      stack: [{ name: 'home' }],
      answers: {},
      visitor: -1,
      idNumber: '',
      noticeOk: {},
      startedAt: null
    };
  }

  const screen = () => session.stack[session.stack.length - 1];

  function go(next) {
    session.stack.push(next);
    history.pushState({ sid: session.id, d: session.stack.length - 1 }, '');
    render(true);
  }

  function back() {
    if (session.stack.length > 1) history.back();
  }

  function resetAll() {
    closeOverlay(false);
    document.documentElement.dataset.size = 'normal';
    ui.programTab = 'now';
    newSession();
    history.pushState({ sid: session.id, d: 0 }, '');
    render(true);
  }

  window.addEventListener('popstate', (e) => {
    const st = e.state;
    if (!st || st.sid !== session.id) { resetAll(); return; }
    if (st.d < session.stack.length - 1) {
      session.stack.length = st.d + 1;
      closeOverlay(false);
      render(true);
    } else {
      history.replaceState({ sid: session.id, d: session.stack.length - 1 }, '');
    }
  });

  /* ── 접수 흐름 정의 ───────────────────────────────── */

  const flows = list(C.reception);

  function getFlow(id) {
    if (id === 'nursing') {
      return {
        id: 'nursing',
        title: '모유수유실 이용',
        questions: [],
        notice: null,
        next: ['직원이 모유수유실을 열어 드립니다.', '사용 후 직원에게 알려 주세요.']
      };
    }
    return flows.find((f) => f.id === id) || null;
  }

  function optionsOf(q) {
    if (q.fromCheckups) return list(C.checkups).map((c) => ({ label: c.name }));
    return list(q.options).map((o) => (typeof o === 'string' ? { label: o } : o));
  }

  function stepsOf(flow) {
    const steps = list(flow.questions).map((q) => ({ kind: 'q', q }));
    if (flow.notice && list(flow.notice.items).length) steps.push({ kind: 'notice' });
    if (K.askVisitorType && VT.length) {
      steps.push({ kind: 'visitor' });
      if (needsId(vtOf(session.visitor))) steps.push({ kind: 'id' });
    }
    return steps;
  }

  const answersOf = (flowId) => (session.answers[flowId] = session.answers[flowId] || {});

  function startFlow(id) {
    const flow = getFlow(id);
    if (!flow) return;
    session.answers[id] = {};
    session.noticeOk[id] = false;
    session.visitor = -1;
    session.idNumber = '';
    session.startedAt = now();
    if (!stepsOf(flow).length) { finishFlow(flow); return; }
    go({ name: 'flow', flow: id, step: 0 });
  }

  function hasUrgent(flow) {
    const a = answersOf(flow.id);
    for (const q of list(flow.questions)) {
      const opts = optionsOf(q);
      const hit = list(a[q.id]).map((i) => opts[i]).find((o) => o && o.urgent);
      if (hit) return hit.label;
    }
    return '';
  }

  function finishFlow(flow) {
    // TODO(server): 서버 연동 시 여기에서 submitVisit()을 호출합니다.
    go({ name: 'slip', flow: flow.id });
  }

  /* ── 공통 부분 ─────────────────────────────────────── */

  function renderTop() {
    const s = screen();
    const large = document.documentElement.dataset.size === 'large';
    return `
      <header class="top">
        <div class="wrap top-inner">
          <div class="brand">
            ${ICON.mark}
            <div>
              <h1 class="brand-name">${esc(F.name || '건강관리실')}</h1>
              ${F.org ? `<div class="brand-org">${esc(F.org)}</div>` : ''}
            </div>
          </div>
          <div class="clock" id="clock">${clockText()}</div>
          <button class="top-btn" data-act="size" aria-pressed="${large}">글자 크게</button>
          ${s.name !== 'home' ? '<button class="top-btn" data-act="home">처음으로</button>' : ''}
          <button class="top-btn is-emergency" data-act="emergency">응급상황</button>
        </div>
      </header>
      ${s.name === 'home' ? `<div class="status"><div class="wrap status-inner" id="status">${statusText()}</div></div>` : ''}`;
  }

  function clockText() {
    const n = now();
    return `${n.getMonth() + 1}월 ${n.getDate()}일 ${DOW[n.getDay()]}요일 ${hm(n)}`;
  }

  function statusText() {
    const st = hoursStatus();
    const wd = weekdayText();
    const cls = st.state === 'open' ? 'is-open' : st.state === 'lunch' ? 'is-lunch' : 'is-closed';
    const todayHours = st.h ? `${st.h.openText}-${st.h.closeText}` : `${H.open || '09:00'}-${H.close || '17:00'}`;
    return `
      <span class="status-state ${cls}">${esc(st.label)}</span>
      <span><b>운영시간</b>${esc(wd.open)} ${esc(todayHours)}${H.lunch ? ` (점심시간 ${esc(H.lunch.start)}-${esc(H.lunch.end)})` : ''}, ${esc(wd.off)} 휴무</span>
      ${F.location ? `<span><b>위치</b>${esc(F.location)}</span>` : ''}
      ${F.phone ? `<span><b>전화</b>${esc(F.phone)}</span>` : ''}`;
  }

  function renderFoot() {
    return `<footer class="foot"><div class="wrap">이 화면에서 선택한 내용은 저장되거나 전송되지 않습니다. 사용이 끝나면 처음으로 버튼을 눌러 주세요.</div></footer>`;
  }

  function pageFoot(extra) {
    return `<div class="page-foot">${extra || ''}<button class="btn" data-act="back">이전</button></div>`;
  }

  function linkButton(label, url, opts) {
    const u = safeUrl(url);
    if (!u) return '';
    const o = opts || {};
    return `<button class="btn ${o.primary ? 'btn-primary' : ''} ${o.small ? 'btn-sm' : ''}" data-act="link" data-url="${esc(u)}" data-title="${esc(o.title || label)}" data-sens="${o.sensitive ? 1 : 0}">${esc(label)}</button>`;
  }

  /* ── 첫 화면 ──────────────────────────────────────── */

  function programStatus(p) {
    const today = ymd(now());
    const start = p.startDate || '';
    const end = p.endDate || p.startDate || '';
    if (end && end < today) return 'end';
    if (start && start > today) return 'soon';
    return 'now';
  }

  function dateRange(p) {
    const s = parseDate(p.startDate);
    const e = parseDate(p.endDate || p.startDate);
    if (!s) return '';
    if (!e || ymd(s) === ymd(e)) return md(s);
    return `${md(s)} ~ ${md(e)}`;
  }

  function shortRange(p) {
    const s = parseDate(p.startDate);
    const e = parseDate(p.endDate || p.startDate);
    if (!s) return '';
    const a = `${s.getMonth() + 1}월 ${s.getDate()}일`;
    if (!e || ymd(s) === ymd(e)) return a;
    if (s.getMonth() === e.getMonth()) return `${a}~${e.getDate()}일`;
    return `${a}~${e.getMonth() + 1}월 ${e.getDate()}일`;
  }

  function currentPrograms() {
    const order = { now: 0, soon: 1 };
    return list(C.programs)
      .filter((p) => p && p.title && programStatus(p) !== 'end')
      .sort((a, b) => (order[programStatus(a)] - order[programStatus(b)])
        || String(a.startDate).localeCompare(String(b.startDate)));
  }

  function pastPrograms() {
    const limit = new Date(now().getTime() - (Number(C.programPastDays) || 90) * 86400000);
    return list(C.programs)
      .filter((p) => p && p.title && programStatus(p) === 'end')
      .filter((p) => (parseDate(p.endDate || p.startDate) || 0) >= limit)
      .sort((a, b) => String(b.endDate || b.startDate).localeCompare(String(a.endDate || a.startDate)));
  }

  function renderReceptionPanel(st) {
    if (st.state === 'open') {
      return `
        <section class="reception" aria-labelledby="rc-h">
          <h2 id="rc-h">어떤 일로 오셨나요?</h2>
          <p>해당하는 항목을 누르면 몇 가지만 여쭤본 뒤, 직원에게 보여 줄 화면을 만들어 드립니다.</p>
          <div class="rc-list">
            ${flows.map((f) => `
              <button class="rc" data-act="flow" data-flow="${esc(f.id)}">
                <span class="rc-text"><span class="rc-title">${esc(f.title)}</span><span class="rc-sub">${esc(f.sub)}</span></span>
                ${ICON.chev}
              </button>`).join('')}
          </div>
        </section>`;
    }

    const wd = weekdayText();
    const titles = {
      lunch: '지금은 점심시간입니다',
      before: '아직 운영 전입니다',
      after: '오늘 운영이 끝났습니다',
      holiday: list(H.weekdays).includes(now().getDay()) || !list(H.weekdays).length && [1, 2, 3, 4, 5].includes(now().getDay())
        ? '오늘은 휴무일입니다' : '주말에는 운영하지 않습니다'
    };
    const lead = {
      lunch: `${H.lunch ? H.lunch.end : '13:00'}부터 다시 접수합니다. 잠시 기다려 주세요.`,
      before: `오늘은 ${st.h ? st.h.openText : '09:00'}부터 접수합니다.`,
      after: st.next ? `다음 운영은 ${st.next}부터입니다.` : '',
      holiday: st.next ? `다음 운영은 ${st.next}부터입니다.` : ''
    };
    return `
      <section class="reception is-off" aria-labelledby="rc-h">
        <h2 id="rc-h">${esc(titles[st.state])}</h2>
        <p class="off-lead">${esc(lead[st.state])}</p>
        <dl class="off-hours">
          <dt>운영시간</dt><dd>${esc(wd.open)} ${esc(H.open || '09:00')}-${esc(H.close || '17:00')}</dd>
          ${H.lunch ? `<dt>점심시간</dt><dd>${esc(H.lunch.start)}-${esc(H.lunch.end)}</dd>` : ''}
          <dt>휴무</dt><dd>${esc(wd.off)}</dd>
        </dl>
        <div class="off-urgent">
          <p>${st.state === 'lunch'
            ? '급하게 도움이 필요하면 기다리지 말고 응급상황 버튼을 눌러 주세요.'
            : esc(F.afterHours || '응급상황은 119로 신고해 주세요.')}</p>
          <button class="btn btn-danger" data-act="emergency">응급상황 안내 보기</button>
        </div>
        <p class="off-more">건강 프로그램과 이용 안내는 지금도 볼 수 있습니다.</p>
      </section>`;
  }

  function renderHome() {
    const st = hoursStatus();
    const progs = currentPrograms();
    const n = now();
    const guide = [
      { to: 'education', title: '건강교육', sub: '심폐소생술, 금연, 감염병 예방 교육 등', show: list(C.education).length },
      { to: 'checkinfo', title: '건강검사 안내', sub: '학생 건강검사, 간이검사 항목과 준비 사항', show: list(C.checkups).length || C.studentCheckup },
      { to: 'nursing', title: '모유수유실', sub: '위치, 시설, 이용 방법', show: C.nursingRoom },
      { to: 'hospital', title: '병원 진료비 감면', sub: '제휴 병원, 감면 대상과 비율, 제출 서류', show: list(C.hospitals).length },
      { to: 'selfcheck', title: '자가진단', sub: '정신건강 자가검진, 상담 전화', show: list(C.selfChecks).length },
      { to: 'infection', title: '감염병 예방과 신고', sub: '진단받았을 때 할 일, 등교 중지 기준', show: C.infection },
      { to: 'other', title: '기타 업무', sub: '위생 점검, 확인서 발급, 자동심장충격기 위치', show: list(C.otherServices).length }
    ].filter((g) => g.show);

    return `
      <main><div class="wrap">
        <div class="alert" role="note">
          <p>의식이 없거나 숨쉬기 힘든 경우, 피가 멈추지 않는 경우에는 접수하지 말고 바로 직원에게 알려 주세요.</p>
        </div>
        <div class="home">
          ${renderReceptionPanel(st)}
          <section class="guide" aria-label="안내">
            <button class="month" data-act="go" data-to="programs">
              <span class="month-head"><h2>이달의 건강 프로그램</h2><span>${n.getMonth() + 1}월 전체 보기</span></span>
              ${progs.length ? `
                <ul class="month-list">
                  ${progs.slice(0, 3).map((p) => `
                    <li><span class="when">${esc(shortRange(p))}</span>
                    <span class="what">${programStatus(p) === 'now' ? '<span class="badge is-now">진행 중</span>' : ''}${esc(p.title)}</span></li>`).join('')}
                </ul>
                ${progs.length > 3 ? `<span class="month-more">외 ${progs.length - 3}건</span>` : ''}`
              : '<p class="month-empty">지금 진행 중이거나 예정된 프로그램이 없습니다.</p>'}
            </button>
            ${guide.map((g) => `
              <button class="gl" data-act="go" data-to="${g.to}">
                <span class="gl-text"><span class="gl-title">${esc(g.title)}</span><span class="gl-sub">${esc(g.sub)}</span></span>
                ${ICON.chev}
              </button>`).join('')}
          </section>
        </div>
      </div></main>`;
  }

  /* ── 접수 단계 화면 ───────────────────────────────── */

  function renderFlow(s) {
    const flow = getFlow(s.flow);
    const steps = stepsOf(flow);
    const step = steps[s.step];
    const a = answersOf(flow.id);
    const progress = `
      <div class="progress">
        <span>${esc(flow.title)}, ${s.step + 1}/${steps.length}단계</span>
        <span class="progress-bar" aria-hidden="true">${steps.map((_, i) => `<i class="${i <= s.step ? 'is-done' : ''}"></i>`).join('')}</span>
      </div>`;

    let body = '';
    let ready = false;
    let nextLabel = s.step === steps.length - 1 ? '직원 확인 화면 보기' : '다음';

    if (step.kind === 'q') {
      const q = step.q;
      const opts = optionsOf(q);
      const sel = list(a[q.id]);
      const multi = q.type === 'multi';
      ready = sel.length > 0;
      const normal = opts.map((o, i) => ({ o, i })).filter((x) => !x.o.urgent);
      const urgent = opts.map((o, i) => ({ o, i })).filter((x) => x.o.urgent);
      const btn = ({ o, i }) => `
        <button class="opt ${multi ? 'is-multi' : ''} ${o.urgent ? 'is-urgent' : ''}" data-act="opt" data-i="${i}" aria-pressed="${sel.includes(i)}">
          <span class="mark">${ICON.check}</span><span>${esc(o.label)}</span>
        </button>`;
      body = `
        <h2>${esc(q.question)}</h2>
        <p class="help">${esc(q.help || (multi ? '해당하는 항목을 모두 골라 주세요.' : '하나를 골라 주세요.'))}</p>
        <div class="opts" role="group" aria-label="${esc(q.label || q.question)}">
          ${normal.map(btn).join('')}
          ${urgent.length ? `<p class="opts-head">아래에 해당하면 바로 직원에게 알려야 합니다</p>${urgent.map(btn).join('')}` : ''}
        </div>`;
      if (q.fromCheckups && sel.length) {
        const cs = list(C.checkups);
        body += `
          <div class="rules prep">
            <ul>${sel.map((i) => cs[i]).filter(Boolean).map((c) => `<li><strong>${esc(c.name)}</strong> ${esc(c.prep)}</li>`).join('')}</ul>
          </div>`;
      }
    } else if (step.kind === 'notice') {
      ready = true;
      nextLabel = flow.notice.confirm || '안내를 확인했습니다';
      if (s.step === steps.length - 1) nextLabel = `${nextLabel}`;
      body = `
        <h2>${esc(flow.notice.title || '이용 안내')}</h2>
        <p class="help">아래 내용을 읽고 확인 버튼을 눌러 주세요.</p>
        <div class="rules"><ul>${list(flow.notice.items).map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
    } else if (step.kind === 'visitor') {
      ready = session.visitor >= 0;
      body = `
        <h2>소속을 골라 주세요</h2>
        <p class="help">학생과 교직원은 다음 화면에서 번호를 입력합니다.</p>
        <div class="opts" role="group" aria-label="소속">
          ${VT.map((t, i) => `
            <button class="opt" data-act="visitor" data-i="${i}" aria-pressed="${session.visitor === i}">
              <span class="mark">${ICON.check}</span><span>${esc(t.label)}</span>
            </button>`).join('')}
        </div>`;
    } else {
      const v = vtOf(session.visitor);
      const n = session.idNumber;
      ready = n.length >= idMin(v) && n.length <= idMax(v);
      const lenText = idMin(v) === idMax(v) ? `${idMin(v)}자리` : `${idMin(v)}-${idMax(v)}자리`;
      body = `
        <h2>${esc(v.idLabel)}을 입력해 주세요</h2>
        <p class="help">숫자 ${esc(lenText)}를 입력합니다. 입력한 번호는 직원 확인용으로만 쓰이고 이 기기에 저장되지 않습니다.</p>
        <div class="id-entry">
          <div class="id-display ${n ? '' : 'is-empty'}" aria-live="polite" aria-label="${esc(v.idLabel)}">${n ? esc(n) : esc(v.idLabel)}</div>
          <div class="keypad" role="group" aria-label="숫자 입력">
            ${['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => `<button class="key" data-act="key" data-k="${k}">${k}</button>`).join('')}
            <button class="key is-fn" data-act="key" data-k="clr">전체 지우기</button>
            <button class="key" data-act="key" data-k="0">0</button>
            <button class="key is-fn" data-act="key" data-k="del">지우기</button>
          </div>
        </div>`;
    }

    return `
      <main><div class="wrap"><section class="flow">${progress}${body}</section></div></main>
      <div class="bar"><div class="wrap bar-inner">
        <button class="btn" data-act="back">이전</button>
        <button class="btn btn-primary" data-act="next" ${ready ? '' : 'disabled'}>${esc(nextLabel)}</button>
      </div></div>`;
  }

  function renderSlip(s) {
    const flow = getFlow(s.flow);
    const a = answersOf(flow.id);
    const st = hoursStatus();
    const rows = [['방문 목적', esc(flow.title)]];
    list(flow.questions).forEach((q) => {
      const opts = optionsOf(q);
      const sel = list(a[q.id]).map((i) => opts[i]).filter(Boolean);
      if (!sel.length) return;
      const plain = sel.filter((o) => !o.flag).map((o) => esc(o.label));
      const flagged = sel.filter((o) => o.flag).map((o) => `<span class="flagged">${esc(o.label)}</span>`);
      rows.push([q.label || q.question, [plain.join(', '), flagged.join('')].filter(Boolean).join(plain.length && flagged.length ? '<br>' : '')]);
    });
    if (session.noticeOk[flow.id] && flow.notice) rows.push(['이용 안내', '확인함']);
    const v = vtOf(session.visitor);
    if (v) rows.push(['소속', esc(v.label)]);
    if (needsId(v) && session.idNumber) rows.push([v.idLabel, esc(K.maskIdOnScreen ? maskId(session.idNumber) : session.idNumber)]);
    const qr = K.slipQr ? qrSvg(slipText(flow), 'L') : '';

    // TODO(server): 서버 연동 후 접수번호와 대기 순번을 이 자리에 표시합니다.
    return `
      <main><div class="wrap">
        <article class="slip">
          <header class="slip-head">
            <h2>직원에게 이 화면을 보여 주세요</h2>
            <span>작성 시각 ${hm(session.startedAt || now())}</span>
          </header>
          <div class="slip-body">
            <div class="slip-main ${qr ? 'has-qr' : ''}">
              <dl class="slip-rows">${rows.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${val}</dd>`).join('')}</dl>
              ${qr ? `
                <figure class="slip-qr">
                  <div class="qr">${qr}</div>
                  <figcaption>직원 확인용 QR코드</figcaption>
                </figure>` : ''}
            </div>
            ${st.state !== 'open' ? `<p class="slip-warn">지금은 ${esc(st.label)}이라 직원 응대가 늦어질 수 있습니다.</p>` : ''}
            ${list(flow.next).length ? `
              <div class="slip-next">
                <h3>이후 진행</h3>
                <ul class="bullets">${flow.next.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
              </div>` : ''}
            <p class="slip-foot">
              ${F.staffCallText ? `${esc(F.staffCallText)} ` : ''}이용 순서는 도착 순서와 증상에 따라 직원이 안내합니다.<br>
              이 화면은 <span class="count" id="slip-count">${K.summarySeconds}</span>초 뒤 처음 화면으로 돌아가며, 내용은 저장되지 않습니다.
            </p>
          </div>
        </article>
      </div></main>
      <div class="bar"><div class="wrap bar-inner">
        <button class="btn" data-act="back">수정하기</button>
        <button class="btn btn-primary" data-act="home">확인했습니다</button>
      </div></div>`;
  }

  function maskId(n) {
    const keep = n.length > 6 ? 4 : 2;
    return n.slice(0, keep) + '*'.repeat(Math.max(0, n.length - keep));
  }

  // 직원이 휴대전화로 QR코드를 찍으면 보이는 글입니다.
  function slipText(flow) {
    const a = answersOf(flow.id);
    const t = session.startedAt || now();
    const lines = [`[${F.name || '건강관리실'} 방문 문진]`, `작성: ${ymd(t)} ${hm(t)}`, `방문 목적: ${flow.title}`];
    list(flow.questions).forEach((q) => {
      const opts = optionsOf(q);
      const sel = list(a[q.id]).map((i) => opts[i]).filter(Boolean);
      if (sel.length) lines.push(`${q.label || q.question}: ${sel.map((o) => (o.flag ? `${o.label}(확인 필요)` : o.label)).join(', ')}`);
    });
    if (session.noticeOk[flow.id] && flow.notice) lines.push('이용 안내: 확인함');
    const v = vtOf(session.visitor);
    if (v) lines.push(`소속: ${v.label}`);
    if (needsId(v) && session.idNumber) lines.push(`${v.idLabel}: ${session.idNumber}`);
    return lines.join('\n');
  }

  /* ── 안내 화면 ─────────────────────────────────────── */

  function page(title, lead, inner, footExtra) {
    return `
      <main><div class="wrap"><article class="page">
        <header class="page-head"><h2>${esc(title)}</h2>${lead ? `<p>${esc(lead)}</p>` : ''}</header>
        ${inner}
        ${pageFoot(footExtra)}
      </article></div></main>`;
  }

  const dl = (rows) => {
    const r = rows.filter(([, v]) => v);
    return r.length ? `<dl class="dl">${r.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : '';
  };

  function renderPrograms() {
    const cur = currentPrograms();
    const past = pastPrograms();
    const items = ui.programTab === 'past' ? past : cur;
    const badge = { now: '<span class="badge is-now">진행 중</span>', soon: '<span class="badge is-soon">예정</span>', end: '<span class="badge is-end">종료</span>' };
    const inner = `
      <div class="tabs" role="tablist">
        <button class="tab" role="tab" data-act="tab" data-tab="now" aria-selected="${ui.programTab !== 'past'}">진행 중, 예정 ${cur.length}건</button>
        <button class="tab" role="tab" data-act="tab" data-tab="past" aria-selected="${ui.programTab === 'past'}">지난 행사 ${past.length}건</button>
      </div>
      <div>
        ${items.length ? items.map((p) => {
          const stt = programStatus(p);
          return `
            <section class="item ${stt === 'end' ? 'is-ended' : ''}">
              <p class="cat">${badge[stt]}${esc(p.category || '')}</p>
              <h3>${esc(p.title)}</h3>
              ${dl([
                ['일정', [dateRange(p), p.time].filter(Boolean).join(', ')],
                ['장소', p.place], ['대상', p.target], ['참여 방법', p.how], ['준비물', p.bring]
              ])}
              <div class="actions">
                ${linkButton('상세 공지 보기', p.noticeUrl, { title: p.title, small: true })}
                ${stt !== 'end' ? linkButton('참여 신청하기', p.applyUrl, { title: `${p.title} 신청`, primary: true, small: true }) : ''}
              </div>
            </section>`;
        }).join('') : `<p class="empty">${ui.programTab === 'past' ? '최근에 끝난 행사가 없습니다.' : '지금 진행 중이거나 예정된 프로그램이 없습니다. 새 프로그램은 건강관리실 게시판에서 알려 드립니다.'}</p>`}
      </div>`;
    return page('이달의 건강 프로그램', '간이검사, 건강교육, 캠페인 일정을 확인하세요. 별도 신청이 필요한 행사는 QR코드로 신청할 수 있습니다.', inner);
  }

  function renderEducation() {
    const inner = list(C.education).map((e) => `
      <section class="item">
        <h3>${esc(e.title)}</h3>
        <p>${esc(e.description)}</p>
        ${dl([['대상', e.target], ['운영', e.schedule], ['신청 방법', e.how]])}
        ${safeUrl(e.url) ? `<div class="actions">${linkButton('자세히 보기', e.url, { title: e.title, small: true })}</div>` : ''}
      </section>`).join('');
    return page('건강교육', '건강관리실에서 운영하는 교육입니다. 이번 달 일정은 건강 프로그램에서 확인할 수 있습니다.', inner,
      '<button class="btn btn-primary" data-act="go" data-to="programs">이달의 프로그램 보기</button>');
  }

  function renderCheckInfo() {
    const sc = C.studentCheckup;
    const cs = list(C.checkups);
    const inner = `
      ${sc ? `
        <section class="sec">
          <h3>${esc(sc.title || '학생 정기 건강검사')}</h3>
          <p>${esc(sc.description)}</p>
          ${dl(list(sc.rows))}
          ${safeUrl(sc.noticeUrl) ? `<div class="actions mt">${linkButton('건강검사 공지 보기', sc.noticeUrl, { title: sc.title, small: true })}</div>` : ''}
        </section>` : ''}
      ${cs.length ? `
        <section class="sec">
          <h3>간이검사</h3>
          <p>운영시간 중 예약 없이 받을 수 있습니다.</p>
          <div class="table-wrap mt">
            <table>
              <thead><tr><th>검사</th><th>소요 시간</th><th>준비 사항</th><th>비용</th></tr></thead>
              <tbody>${cs.map((c) => `<tr><td class="strong">${esc(c.name)}</td><td>${esc(c.time)}</td><td>${esc(c.prep)}</td><td>${esc(c.fee)}</td></tr>`).join('')}</tbody>
            </table>
          </div>
        </section>` : ''}`;
    const canStart = hoursStatus().state === 'open' && getFlow('checkup');
    return page('건강검사 안내', '', inner, canStart ? '<button class="btn btn-primary" data-act="flow" data-flow="checkup">지금 검사 받기</button>' : '');
  }

  function renderNursing() {
    const n = C.nursingRoom || {};
    const inner = `
      <section class="sec">
        ${dl([['위치', n.location], ['이용 시간', n.hours], ['이용 대상', n.target]])}
      </section>
      ${list(n.facilities).length ? `<section class="sec"><h3>갖춰진 시설</h3><ul class="chips">${n.facilities.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></section>` : ''}
      ${list(n.steps).length ? `<section class="sec"><h3>이용 방법</h3><ol class="steps">${n.steps.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></section>` : ''}
      ${n.note ? `<p class="note">${esc(n.note)}</p>` : ''}`;
    const canStart = hoursStatus().state === 'open';
    return page('모유수유실', '', inner, canStart ? '<button class="btn btn-primary" data-act="flow" data-flow="nursing">이용 요청하기</button>' : '');
  }

  function renderHospital() {
    const g = C.hospitalGuide || {};
    const inner = `
      ${list(g.steps).length ? `<section class="sec"><h3>이용 방법</h3><ol class="steps">${g.steps.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></section>` : ''}
      <section class="sec">
        <h3>제휴 병원</h3>
        ${list(C.hospitals).map((h) => `
          <div class="item">
            <h3>${esc(h.name)}</h3>
            ${dl([['감면 대상', h.target], ['감면 내용', h.benefit], ['제출 서류', h.documents], ['연락처', h.contact], ['참고', h.note]])}
          </div>`).join('')}
      </section>
      ${g.caution ? `<p class="note">${esc(g.caution)}</p>` : ''}`;
    return page('병원 진료비 감면', g.intro, inner);
  }

  function renderSelfCheck() {
    const inner = `
      ${list(C.selfChecks).map((s) => {
        const u = safeUrl(s.url);
        return `
          <section class="item">
            <div class="item-row">
              <div>
                <h3>${esc(s.title)}</h3>
                <p>${esc(s.description)}</p>
                <p class="qr-hint">${s.sensitive
                  ? '휴대전화 카메라로 QR코드를 찍으면 검사 페이지가 열립니다. 결과는 본인만 볼 수 있도록 개인 휴대전화로 이용해 주세요.'
                  : '휴대전화 카메라로 QR코드를 찍으면 페이지가 열립니다.'}</p>
                ${!s.sensitive && K.allowOpenLinksOnDevice && u ? `<div class="actions">${linkButton('이 기기에서 보기', u, { title: s.title, small: true })}</div>` : ''}
              </div>
              ${u ? `<div class="qr qr-sm">${qrSvg(u)}</div>` : ''}
            </div>
          </section>`;
      }).join('')}
      ${list(C.crisisLines).length ? `
        <section class="callout is-crisis mt">
          <h3>혼자 견디기 힘들다면 바로 이야기해 주세요</h3>
          <ul class="lines">${C.crisisLines.map((l) => `<li><span class="num">${esc(l.number)}</span><span>${esc(l.name)}</span><span class="meta">${esc(l.note)}</span></li>`).join('')}</ul>
        </section>` : ''}`;
    const canStart = hoursStatus().state === 'open' && getFlow('counsel');
    return page('자가진단', '검사 결과는 진단이 아니며, 걱정되는 결과가 나오면 건강관리실이나 상담센터와 상의해 주세요.', inner,
      canStart ? '<button class="btn btn-primary" data-act="flow" data-flow="counsel">건강상담 신청하기</button>' : '');
  }

  function renderInfection() {
    const inf = C.infection || {};
    const inner = `
      ${list(inf.steps).length ? `
        <section class="sec">
          <h3>감염병 진단을 받았다면</h3>
          <ol class="steps">${inf.steps.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
          <div class="callout mt">
            <h3>신고 방법</h3>
            <p>${inf.reportPhone ? `전화 ${esc(inf.reportPhone)}` : ''}${inf.reportPhone && safeUrl(inf.reportUrl) ? ', 또는 온라인 신고서를 작성해 주세요.' : ''}</p>
            ${safeUrl(inf.reportUrl) ? `<div class="actions mt">${linkButton('온라인 신고서 열기', inf.reportUrl, { title: '감염병 신고서', small: true, sensitive: true })}</div>` : ''}
          </div>
        </section>` : ''}
      ${list(inf.diseases).length ? `
        <section class="sec">
          <h3>주요 감염병과 등교 중지 기준</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>감염병</th><th>주요 증상</th><th>등교 중지 기간</th></tr></thead>
              <tbody>${inf.diseases.map((d) => `<tr><td class="strong">${esc(d.name)}</td><td>${esc(d.symptoms)}</td><td>${esc(d.rule)}</td></tr>`).join('')}</tbody>
            </table>
          </div>
          ${inf.disclaimer ? `<p class="note">${esc(inf.disclaimer)}</p>` : ''}
        </section>` : ''}
      ${list(inf.prevention).length ? `<section class="sec"><h3>예방 수칙</h3><ul class="bullets">${inf.prevention.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>` : ''}`;
    return page('감염병 예방과 신고', '다른 사람에게 옮길 수 있는 감염병으로 진단받으면 건강관리실에 알려 주세요.', inner);
  }

  function renderOther() {
    const aed = list(C.emergency && C.emergency.aed);
    const inner = `
      ${list(C.otherServices).map((o) => `<section class="item"><h3>${esc(o.title)}</h3><p>${esc(o.description)}</p></section>`).join('')}
      ${aed.length ? `<section class="sec"><h3>자동심장충격기(AED) 위치</h3><ul class="bullets">${aed.map((a) => `<li>${esc(a.place)}</li>`).join('')}</ul></section>` : ''}`;
    return page('기타 업무', '그 밖에 건강관리실에서 맡고 있는 일입니다. 문의는 직원에게 해 주세요.', inner);
  }

  /* ── 겹침 화면 ─────────────────────────────────────── */

  function qrSvg(text, level) {
    if (typeof window.qrcode !== 'function') return '';
    try {
      if (window.qrcode.stringToBytesFuncs && window.qrcode.stringToBytesFuncs['UTF-8']) {
        window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs['UTF-8'];
      }
      const q = window.qrcode(0, level || 'M');
      q.addData(text, 'Byte');
      q.make();
      const n = q.getModuleCount();
      let d = '';
      for (let r = 0; r < n; r += 1) {
        for (let c = 0; c < n; c += 1) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      }
      return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" role="img" aria-label="QR코드"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
    } catch (e) {
      return '';
    }
  }

  function renderOverlay() {
    const o = ui.overlay;
    if (!o) { layer.innerHTML = ''; return; }

    if (o.type === 'emergency') {
      const E = C.emergency || {};
      layer.innerHTML = `
        <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="em-h">
          <div class="sheet is-emergency">
            <div class="em-head">
              <h2 id="em-h">지금 바로 직원에게 알려 주세요</h2>
              <p>${o.reason ? '선택하신 상태는 바로 확인이 필요합니다. ' : ''}응급상황에서는 화면 접수를 하지 않아도 됩니다. 직원이 보이지 않으면 큰 소리로 주변에 도움을 요청하세요.</p>
            </div>
            <div class="em-body">
              <div class="full em-call">
                <div><strong>119</strong><span>구급차 요청</span></div>
                ${F.phone ? `<div><strong>${esc(F.phone)}</strong><span>${esc(F.name || '건강관리실')}</span></div>` : ''}
              </div>
              ${list(E.signs).length ? `<div><h3>이런 경우는 응급상황입니다</h3><ul class="bullets">${E.signs.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
              ${list(E.aed).length ? `<div><h3>자동심장충격기(AED) 위치</h3><ul class="bullets">${E.aed.map((a) => `<li>${esc(a.place)}</li>`).join('')}</ul></div>` : ''}
              <div class="full actions">
                ${o.reason
                  ? '<button class="btn btn-danger btn-wide" data-act="em-done">직원에게 알렸습니다</button><button class="btn" data-act="em-undo">잘못 골랐어요</button>'
                  : '<button class="btn btn-wide" data-act="close">닫기</button>'}
              </div>
            </div>
          </div>
        </div>`;
    } else if (o.type === 'link') {
      const canOpen = K.allowOpenLinksOnDevice && !o.sensitive;
      layer.innerHTML = `
        <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="lk-h" data-act="backdrop">
          <div class="sheet">
            <h2 id="lk-h">${esc(o.title)}</h2>
            <div class="qr-box">
              <div class="qr">${qrSvg(o.url)}</div>
              <div class="qr-text">
                <p>휴대전화 카메라로 QR코드를 찍으면 이 페이지가 열립니다.</p>
                ${canOpen ? '<p>이 기기에서 보려면 아래 버튼을 눌러 주세요. 새 창으로 열리며, 다 본 뒤에는 창을 닫아 주세요.</p>' : ''}
                <p class="qr-url">${esc(o.url)}</p>
              </div>
            </div>
            <div class="actions">
              ${canOpen ? '<button class="btn btn-primary" data-act="open-ext">이 기기에서 열기</button>' : ''}
              <button class="btn" data-act="close">닫기</button>
            </div>
          </div>
        </div>`;
    } else if (o.type === 'idle') {
      layer.innerHTML = `
        <div class="overlay" role="alertdialog" aria-modal="true" aria-labelledby="idle-h">
          <div class="sheet">
            <h2 id="idle-h">계속 이용하시나요?</h2>
            <p><span class="count" id="idle-count">${K.idleWarningSeconds}</span>초 뒤 처음 화면으로 돌아가고, 선택한 내용은 지워집니다.</p>
            <div class="actions">
              <button class="btn btn-primary btn-wide" data-act="close">계속 이용하기</button>
              <button class="btn" data-act="home">처음으로</button>
            </div>
          </div>
        </div>`;
    }
    const first = layer.querySelector('.btn');
    if (first) first.focus({ preventScroll: true });
  }

  function openOverlay(o) { ui.overlay = o; renderOverlay(); }
  function closeOverlay(rerender) {
    ui.overlay = null;
    layer.innerHTML = '';
    if (rerender !== false) armIdle();
  }

  /* ── 렌더링 ────────────────────────────────────────── */

  const PAGES = {
    home: renderHome,
    flow: renderFlow,
    slip: renderSlip,
    programs: renderPrograms,
    education: renderEducation,
    checkinfo: renderCheckInfo,
    nursing: renderNursing,
    hospital: renderHospital,
    selfcheck: renderSelfCheck,
    infection: renderInfection,
    other: renderOther
  };

  function render(toTop) {
    const s = screen();
    const fn = PAGES[s.name] || renderHome;
    const hasBar = s.name === 'flow' || s.name === 'slip';
    app.innerHTML = renderTop() + fn(s) + (hasBar ? '' : renderFoot());
    lastHoursState = hoursStatus().state;
    if (toTop) window.scrollTo(0, 0);
    armIdle();
  }

  /* ── 자동 초기화 ───────────────────────────────────── */

  function isPristine() {
    return screen().name === 'home' && session.stack.length === 1 && !ui.overlay
      && document.documentElement.dataset.size !== 'large';
  }

  function armIdle() {
    if (ui.overlay && ui.overlay.type === 'idle') return;
    if (isPristine()) { idle.deadline = 0; return; }
    const secs = screen().name === 'slip' ? K.summarySeconds : K.idleSeconds;
    idle.deadline = Date.now() + Math.max(20, Number(secs) || 90) * 1000;
  }

  function tick() {
    const clock = document.getElementById('clock');
    if (clock) clock.textContent = clockText();
    const st = document.getElementById('status');
    if (st) { const t = statusText(); if (st.innerHTML !== t) st.innerHTML = t; }

    // 운영 상태가 바뀌면(점심시간 시작 등) 첫 화면을 다시 그립니다.
    const hs = hoursStatus().state;
    if (hs !== lastHoursState) {
      lastHoursState = hs;
      if (screen().name === 'home' && !ui.overlay) render(false);
    }

    if (!idle.deadline) return;
    const left = Math.ceil((idle.deadline - Date.now()) / 1000);
    const sc = document.getElementById('slip-count');
    if (sc) sc.textContent = Math.max(0, left);

    if (left <= 0) { resetAll(); return; }
    if (screen().name !== 'slip' && left <= K.idleWarningSeconds) {
      if (!ui.overlay || ui.overlay.type !== 'idle') openOverlay({ type: 'idle' });
      const ic = document.getElementById('idle-count');
      if (ic) ic.textContent = left;
    }
  }

  /* ── 입력 처리 ─────────────────────────────────────── */

  function toggleOption(i) {
    const s = screen();
    const flow = getFlow(s.flow);
    const q = stepsOf(flow)[s.step].q;
    const opts = optionsOf(q);
    const o = opts[i];
    const a = answersOf(flow.id);
    let sel = list(a[q.id]).slice();
    if (q.type !== 'multi') {
      sel = [i];
    } else if (sel.includes(i)) {
      sel = sel.filter((x) => x !== i);
    } else if (o.only) {
      sel = [i];
    } else {
      sel = sel.filter((x) => !(opts[x] && opts[x].only));
      sel.push(i);
    }
    a[q.id] = sel;
    render(false);
    if (o.urgent && sel.includes(i)) openOverlay({ type: 'emergency', reason: o.label, undo: { q: q.id, i } });
  }

  function pressKey(k) {
    const v = vtOf(session.visitor);
    if (!v) return;
    if (k === 'del') session.idNumber = session.idNumber.slice(0, -1);
    else if (k === 'clr') session.idNumber = '';
    else if (/^\d$/.test(k) && session.idNumber.length < idMax(v)) session.idNumber += k;
    render(false);
  }

  function nextStep() {
    const s = screen();
    const flow = getFlow(s.flow);
    const steps = stepsOf(flow);
    const step = steps[s.step];
    if (step.kind === 'q') {
      if (!list(answersOf(flow.id)[step.q.id]).length) return;
      const urgent = hasUrgent(flow);
      if (urgent) { openOverlay({ type: 'emergency', reason: urgent }); return; }
    }
    if (step.kind === 'notice') session.noticeOk[flow.id] = true;
    if (step.kind === 'visitor' && session.visitor < 0) return;
    if (step.kind === 'id') {
      const v = vtOf(session.visitor);
      if (session.idNumber.length < idMin(v) || session.idNumber.length > idMax(v)) return;
    }
    if (s.step < steps.length - 1) go({ name: 'flow', flow: flow.id, step: s.step + 1 });
    else finishFlow(flow);
  }

  app.addEventListener('click', onAction);
  layer.addEventListener('click', onAction);

  function onAction(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;

    switch (act) {
      case 'backdrop':
        if (e.target === el) closeOverlay();
        break;
      case 'home':
        resetAll();
        break;
      case 'back':
        back();
        break;
      case 'go':
        go({ name: el.dataset.to });
        break;
      case 'flow':
        startFlow(el.dataset.flow);
        break;
      case 'opt':
        toggleOption(Number(el.dataset.i));
        break;
      case 'visitor':
        if (session.visitor !== Number(el.dataset.i)) session.idNumber = '';
        session.visitor = Number(el.dataset.i);
        render(false);
        break;
      case 'next':
        nextStep();
        break;
      case 'key':
        pressKey(el.dataset.k);
        break;
      case 'tab':
        ui.programTab = el.dataset.tab;
        render(false);
        break;
      case 'size': {
        const r = document.documentElement;
        r.dataset.size = r.dataset.size === 'large' ? 'normal' : 'large';
        render(false);
        break;
      }
      case 'emergency':
        openOverlay({ type: 'emergency' });
        break;
      case 'link':
        openOverlay({ type: 'link', url: el.dataset.url, title: el.dataset.title, sensitive: el.dataset.sens === '1' });
        break;
      case 'open-ext':
        if (ui.overlay && ui.overlay.url) window.open(ui.overlay.url, '_blank', 'noopener');
        closeOverlay();
        break;
      case 'em-undo': {
        const u = ui.overlay && ui.overlay.undo;
        if (u) {
          const a = answersOf(screen().flow);
          a[u.q] = list(a[u.q]).filter((x) => x !== u.i);
        } else if (screen().name === 'flow') {
          // 다음 버튼에서 열린 경우: 현재 질문의 응급 항목 선택을 해제합니다.
          const s = screen();
          const flow = getFlow(s.flow);
          const q = stepsOf(flow)[s.step].q;
          if (q) {
            const opts = optionsOf(q);
            const a = answersOf(flow.id);
            a[q.id] = list(a[q.id]).filter((x) => !(opts[x] && opts[x].urgent));
          }
        }
        closeOverlay(false);
        render(false);
        break;
      }
      case 'em-done':
      case 'close':
        if (act === 'em-done') { resetAll(); break; }
        closeOverlay();
        break;
      default:
        break;
    }
  }

  // 화면을 만질 때마다 자동 초기화 시간을 늘립니다.
  let wakeLock = null;
  document.addEventListener('pointerdown', () => {
    if (ui.overlay && ui.overlay.type === 'idle') closeOverlay(false);
    armIdle();
    keepAwake();
    if (K.fullscreenOnTouch && !document.fullscreenElement && document.documentElement.requestFullscreen
        && !window.matchMedia('(display-mode: fullscreen)').matches) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }, { passive: true });
  document.addEventListener('keydown', (e) => {
    armIdle();
    const s = screen();
    if (!ui.overlay && s.name === 'flow') {
      const st = stepsOf(getFlow(s.flow))[s.step];
      if (st && st.kind === 'id') {
        if (/^\d$/.test(e.key)) pressKey(e.key);
        else if (e.key === 'Backspace') pressKey('del');
        else if (e.key === 'Enter') nextStep();
      }
    }
    if (e.key === 'Escape' && ui.overlay && ui.overlay.type !== 'emergency') closeOverlay();
  });

  function keepAwake() {
    if (!K.keepScreenOn || wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    navigator.wakeLock.request('screen').then((l) => {
      wakeLock = l;
      l.addEventListener('release', () => { wakeLock = null; });
    }).catch(() => {});
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { keepAwake(); tick(); }
  });

  // 길게 누르기 메뉴, 확대 제스처 방지
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  /* ── 시작 ──────────────────────────────────────────── */

  (function checkConfig() {
    list(C.programs).forEach((p) => {
      if (p.startDate && !parseDate(p.startDate)) console.warn('[config] 시작일 형식을 확인하세요:', p.title, p.startDate);
      if (p.endDate && !parseDate(p.endDate)) console.warn('[config] 종료일 형식을 확인하세요:', p.title, p.endDate);
    });
    if (!flows.length) console.warn('[config] reception 항목이 비어 있습니다.');
  })();

  newSession();
  history.replaceState({ guard: true }, '');
  history.pushState({ sid: session.id, d: 0 }, '');
  document.title = `${F.name || '건강관리실'} 안내`;
  render(true);
  setInterval(tick, 1000);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
