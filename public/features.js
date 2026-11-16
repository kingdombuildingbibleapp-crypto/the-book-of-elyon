// The Book of Elyon: Today, Study Plans, Topics, Notes and accounts.
// Runs after the reader script in index.html and uses its helpers
// ($, esc, IDX, cur, cache, open, linkRefs, openAsk, openDrawer).
// Accounts and saved data go through window.Elyon (public/js/elyon-client.js).

const PAGES = {};            // route name -> render(args)
let TOPICS = null, PLANS = null;
let me = null;               // { name, email } when signed in
let myNotes = [];            // [{ bookId, chapter, verse, text, updatedAt }]
let myPlans = [];            // [{ planId, startedAt, done: [day] }]
let plus = false;            // has Elyon Plus (checked again on the server)
let plusConfirmed = '';      // Checkout session already confirmed
let plusKnown = false;       // hasPlus has answered at least once since sign-in
let isOwner = false;         // listed in OWNER_EMAILS on the backend
let giftTried = '';          // free link already redeemed this visit
// In the Android and iOS apps, store rules forbid selling the upgrade
// through our own checkout: the apps unlock it by signing in instead.
const isApp = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const locked = () => E().enabled && !plus;
function plusCard(what) {
  return `<div class="plus-card"><p class="pk">✦ Elyon Plus</p><p>${esc(what)}</p>${isApp()
    ? `<p>Sign in with an account that has Elyon Plus.</p>${me ? '' : '<button class="pill solid" data-signin>Sign in</button>'}`
    : '<a class="pill solid" href="#plus">Unlock everything for $1.99</a>'}</div>`;
}
let unwatch = [];
const E = () => window.Elyon || { enabled: false, isSignedIn: () => false };

const json = async (u) => (await fetch(u)).json();
const loadTopics = async () => (TOPICS ??= await json('topics.json'));
const loadPlans = async () => (PLANS ??= await json('data/plans.json'));
const bookName = (id) => (IDX.books.find((b) => b.id === id) || {}).name || id;
const bookOrder = (id) => (IDX.books.find((b) => b.id === id) || {}).order || 999;
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const firstTr = (id) => Object.keys(IDX.books.find((b) => b.id === id).translations)[0];

/** "John 3:16-18" -> { id, ch, v1, v2 } using the reader's book-name map. */
function parseRef(ref) {
  const m = /^(.+?) (\d+):(\d+)(?:-(\d+))?$/.exec(ref);
  if (!m) return null;
  const id = REF_MAP[m[1].toLowerCase()];
  return id ? { id, ch: +m[2], v1: +m[3], v2: +(m[4] || m[3]) } : null;
}
async function versesOf(r) {
  cache[r.id] ??= await json(`data/books/${r.id}.json`);
  const ch = cache[r.id][firstTr(r.id)].chapters[r.ch - 1] || [];
  return ch.slice(r.v1 - 1, r.v2).map((t, i) => ({ n: r.v1 + i, t }));
}
function refLink(r, label) { return `<a href="#${r.id}/_/${r.ch}" data-ref="${r.id}|${r.ch}|${r.v1}">${esc(label)}</a>`; }

// ------------------------------------------------------------ page shell
function page(name, html) {
  cur = { book: null, tr: null, ch: 1, page: name };
  document.body.classList.remove('on-cover');
  $('#main').innerHTML = `<div class="pg-wrap">${html}</div>`;
  $('#nav').classList.remove('open');
  renderList($('#q').value);
  markTab(name);
  scrollTo(0, 0);
}
function markTab(name) {
  if (name === 'owner') name = 'plus';
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === name || (name === 'read' && a.dataset.tab === 'read')));
  $('#home-btn')?.classList.toggle('on', name === 'today');
}
function needAccount(what) {
  if (!E().enabled) return `<div class="card soft"><p>${esc(what)} will be available once accounts are switched on.</p></div>`;
  return `<div class="card soft"><p>${esc(what)} are saved to your account.</p><button class="pill solid" data-signin>Sign in or create an account</button></div>`;
}

// ------------------------------------------------------------ Today
const yt = (v) => v ? `
  <div class="vcard">
    <button class="vthumb" data-yt="${esc(v.youtubeId)}" style="background-image:url('https://i.ytimg.com/vi/${encodeURIComponent(v.youtubeId)}/hqdefault.jpg')" aria-label="Play ${esc(v.title)}"><span>▶</span></button>
    <p class="vt">${esc(v.title)}</p><p class="vb">${esc(v.by)}</p>
  </div>` : `<div class="vcard empty"><p>Today’s video will appear here soon.</p></div>`;

PAGES.today = async () => {
  page('today', `<h2 class="ph">Today</h2><p class="pdate">${new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p><div id="today-body"><p class="loading">Loading…</p></div>`);
  const T = await loadTopics();
  const d = today();
  const dayNum = Math.floor(Date.parse(d) / 86400000);
  const r = parseRef(T.daily[dayNum % T.daily.length]);
  const vs = r ? await versesOf(r) : [];
  if (cur.page !== 'today') return;
  $('#today-body').innerHTML = `
    <section class="card verse-day">
      <p class="eyebrow">Verse for today</p>
      <blockquote>${vs.map((v) => esc(v.t)).join(' ')}</blockquote>
      <p class="vref">${refLink(r, T.daily[dayNum % T.daily.length])} · ${esc(firstTr(r.id))}</p>
    </section>
    <div id="plan-today"></div>
    <div class="two">
      <section class="card"><p class="eyebrow">Word for today</p><p class="sub">A message from a Hebrew or Messianic teacher</p><div id="vid-word">${E().enabled ? '<p class="loading">Loading…</p>' : yt(null)}</div></section>
      <section class="card"><p class="eyebrow">Worship · שִׁיר</p><p class="sub">A song of praise sung in Hebrew</p><div id="vid-worship">${E().enabled ? '<p class="loading">Loading…</p>' : yt(null)}</div></section>
    </div>`;
  renderPlanToday();
  if (E().enabled) {
    const stop = E().watch('videos:forDay', { date: new Date().toISOString().slice(0, 10) }, (x) => {
      if (cur.page !== 'today' || !$('#vid-word')) return stop?.();
      if (x.locked) {
        $('#vid-word').innerHTML = plusCard('A daily message from a Hebrew or Messianic teacher.');
        $('#vid-worship').innerHTML = plusCard('A daily song of worship sung in Hebrew.');
        return;
      }
      $('#vid-word').innerHTML = yt(x.word); $('#vid-worship').innerHTML = yt(x.worship);
    }, () => { if ($('#vid-word')) { $('#vid-word').innerHTML = yt(null); $('#vid-worship').innerHTML = yt(null); } });
  }
};
async function renderPlanToday() {
  const box = $('#plan-today'); if (!box) return;
  if (!myPlans.length) { box.innerHTML = ''; return; }
  const P = await loadPlans();
  box.innerHTML = myPlans.map((mp) => {
    const p = P.find((x) => x.id === mp.planId); if (!p) return '';
    const next = nextDay(p, mp);
    if (!next) return `<section class="card plan-mini"><p class="eyebrow">${esc(p.name)}</p><p>Plan complete. Well done!</p></section>`;
    return `<section class="card plan-mini"><p class="eyebrow">${esc(p.name)} · Day ${next}</p><p class="reading">${readingLinks(p.days[next - 1])}</p>
      <div class="row"><button class="pill solid" data-day="${p.id}|${next}">Mark day ${next} done</button><a class="pill" href="#plan/${p.id}">Open plan</a></div></section>`;
  }).join('');
}

// ------------------------------------------------------------ Study plans
const nextDay = (p, mp) => { const done = new Set(mp.done); for (let i = 1; i <= p.days.length; i++) if (!done.has(i)) return i; return 0; };
const rangeLabel = ([id, a, z]) => `${bookName(id)} ${a}${z > a ? '–' + z : ''}`;
const readingLinks = (day) => day.map((r) => `<a href="#${r[0]}/_/${r[1]}">${esc(rangeLabel(r))}</a>`).join(', ');

PAGES.plans = async () => {
  page('plans', `<h2 class="ph">Study Plans</h2><p class="pintro">Read with purpose, a little each day. Tick off each day as you go; your progress is saved to your account.</p><div id="plans-body"><p class="loading">Loading…</p></div>`);
  const P = await loadPlans();
  if (cur.page !== 'plans') return;
  $('#plans-body').innerHTML = `<div class="grid">${P.map((p) => {
    const mp = myPlans.find((x) => x.planId === p.id);
    const pct = mp ? Math.round((mp.done.length / p.days.length) * 100) : 0;
    return `<a class="card plan" href="#plan/${p.id}">
      <p class="eyebrow">${p.days.length} days${mp ? ` · ${pct}% done` : ''}</p>
      <h3>${esc(p.name)}</h3><p>${esc(p.about)}</p>
      ${mp ? `<div class="bar2"><i style="width:${pct}%"></i></div>` : ''}</a>`;
  }).join('')}</div>`;
};

PAGES.plan = async ([id]) => {
  const P = await loadPlans();
  const p = P.find((x) => x.id === id);
  if (!p) return PAGES.plans();
  const mp = myPlans.find((x) => x.planId === id);
  const done = new Set(mp ? mp.done : []);
  const next = mp ? nextDay(p, mp) : 1;
  page('plans', `<p class="crumb"><a href="#plans">‹ Study Plans</a></p><h2 class="ph">${esc(p.name)}</h2><p class="pintro">${esc(p.about)}</p>
    ${me ? (mp ? `<div class="row"><span class="prog">${done.size} of ${p.days.length} days done</span><button class="pill" id="leave-plan">Leave plan</button></div><div class="bar2"><i style="width:${(done.size / p.days.length) * 100}%"></i></div>`
                : plus ? `<button class="pill solid" id="start-plan">Start this plan</button>` : plusCard('Start study plans and tick off each day as you read.'))
          : needAccount('Study plans')}
    <ol class="days">${p.days.map((day, i) => `<li class="${done.has(i + 1) ? 'done' : ''}${mp && i + 1 === next ? ' next' : ''}">
      <label><input type="checkbox" data-day="${p.id}|${i + 1}" ${done.has(i + 1) ? 'checked' : ''} ${me && plus ? '' : 'disabled'}><span class="dn">Day ${i + 1}</span></label>
      <span class="reading">${readingLinks(day)}</span></li>`).join('')}</ol>`);
  $('#start-plan')?.addEventListener('click', () => act(() => E().mutation('plans:start', { planId: id })));
  $('#leave-plan')?.addEventListener('click', () => { if (confirm(`Leave “${p.name}” and clear your progress?`)) act(() => E().mutation('plans:leave', { planId: id })); });
  if (mp && next) document.querySelector('.days li.next')?.scrollIntoView({ block: 'center' });
};

document.addEventListener('change', (e) => {
  const cb = e.target.closest('input[data-day]'); if (!cb) return;
  const [planId, day] = cb.dataset.day.split('|');
  act(() => E().mutation('plans:setDay', { planId, day: +day, done: cb.checked }), () => { cb.checked = !cb.checked; });
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-day]'); if (!b) return;
  const [planId, day] = b.dataset.day.split('|'); b.disabled = true;
  act(() => E().mutation('plans:setDay', { planId, day: +day, done: true }), () => { b.disabled = false; });
});

// ------------------------------------------------------------ Topics
PAGES.topics = async () => {
  page('topics', `<h2 class="ph">Topics</h2><p class="pintro">Explore what scripture says about a subject. Each topic gathers passages from across the collection.</p><div id="topics-body"><p class="loading">Loading…</p></div>`);
  const T = await loadTopics();
  if (cur.page !== 'topics') return;
  $('#topics-body').innerHTML = `<div class="grid">${T.topics.map((t) => `<a class="card topic" href="#topic/${t.id}"><p class="he" lang="he" dir="rtl">${esc(t.he)}</p><h3>${esc(t.name)}</h3><p>${esc(t.blurb)}</p></a>`).join('')}</div>
    <div class="card soft ask-topic"><p>Looking for something else?</p><button class="pill solid" data-ask-topic="">Ask about any subject</button></div>`;
};
PAGES.topic = async ([id]) => {
  const T = await loadTopics();
  const t = T.topics.find((x) => x.id === id);
  if (!t) return PAGES.topics();
  page('topics', `<p class="crumb"><a href="#topics">‹ Topics</a></p><p class="he big" lang="he" dir="rtl">${esc(t.he)}</p><h2 class="ph">${esc(t.name)}</h2><p class="pintro">${esc(t.blurb)}</p><div id="topic-body"><p class="loading">Loading passages…</p></div>`);
  if (t.names) return renderNames(t);
  const parts = await Promise.all(t.refs.map(async (ref) => { const r = parseRef(ref); return r ? { ref, r, vs: await versesOf(r) } : null; }));
  if (cur.page !== 'topics' || !$('#topic-body')) return;
  $('#topic-body').innerHTML = parts.filter(Boolean).map(({ ref, r, vs }) => `<section class="card passage"><p class="vref">${refLink(r, ref)}</p><p class="ptext">${vs.map((v) => `<sup>${v.n}</sup>${esc(v.t)}`).join(' ')}</p></section>`).join('')
    + `<div class="row"><button class="pill solid" data-ask-topic="${esc(t.name)}">Ask about ${esc(t.name.toLowerCase())}</button></div>`;
};
/** The Names of God: grouped names, each with its meaning and the verse where it appears. */
async function renderNames(t) {
  const groups = await Promise.all(t.names.map(async (g) => ({ group: g.group, items: await Promise.all(g.items.map(async (n) => {
    const r = parseRef(n.ref); return { ...n, r, vs: r ? await versesOf(r) : [] }; })) })));
  if (cur.page !== 'topics' || !$('#topic-body')) return;
  $('#topic-body').innerHTML = `<div class="name-jump" role="navigation" aria-label="Groups">${groups.map((g, i) => `<a href="javascript:void(0)" data-jump="ng${i}">${esc(g.group)}</a>`).join('')}</div>`
    + groups.map((g, i) => `<h3 class="nh" id="ng${i}">${esc(g.group)}</h3><div class="names">${g.items.map((n) => `
      <section class="card name"><div class="nhead"><h4>${esc(n.name)}</h4>${n.he ? `<span class="he" lang="he" dir="rtl">${esc(n.he)}</span>` : ''}</div>
        <p class="nabout">${esc(n.about)}</p>
        ${n.r ? `<p class="ptext small">${n.vs.map((v) => `<sup>${v.n}</sup>${esc(v.t)}`).join(' ')}</p><p class="vref">${refLink(n.r, n.ref)}</p>` : ''}</section>`).join('')}</div>`).join('')
    + `<div class="row"><button class="pill solid" data-ask-topic="the names of God">Ask about the names of God</button></div>`;
  document.querySelectorAll('[data-jump]').forEach((a) => a.onclick = () => document.getElementById(a.dataset.jump).scrollIntoView({ behavior: 'smooth', block: 'start' }));
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ask-topic]'); if (!b) return;
  openAsk(); const s = b.dataset.askTopic;
  $('#ask-in').value = s ? `What does scripture teach about ${s.toLowerCase()}? ` : ''; $('#ask-in').focus();
});

// ------------------------------------------------------------ Notes
PAGES.notes = () => {
  if (!me) return page('notes', `<h2 class="ph">My Notes</h2><p class="pintro">Write your own notes on any verse: double-tap a verse while reading, then use “My note”.</p>${needAccount('Notes')}`);
  const groups = {};
  for (const n of myNotes) (groups[n.bookId] ??= []).push(n);
  const books = Object.keys(groups).sort((a, b) => bookOrder(a) - bookOrder(b));
  if (!plus && !myNotes.length) return page('notes', `<h2 class="ph">My Notes</h2><p class="pintro">Write your own notes on any verse, saved to your account.</p>${plusCard('Write your own notes on any verse: a thought, a prayer, a question.')}`);
  page('notes', `<h2 class="ph">My Notes</h2><p class="pintro">${myNotes.length ? `${myNotes.length} note${myNotes.length === 1 ? '' : 's'}, in the book’s order.` : 'No notes yet. Double-tap any verse while reading, then write in “My note”.'}</p>
    ${books.map((id) => `<h3 class="nh">${esc(bookName(id))}</h3>${groups[id].sort((a, b) => a.chapter - b.chapter || a.verse - b.verse).map((n) => `
      <section class="card note"><p class="vref"><a href="#${id}/_/${n.chapter}" data-ref="${id}|${n.chapter}|${n.verse}">${esc(bookName(id))} ${n.chapter}:${n.verse}</a><span class="when">${new Date(n.updatedAt).toLocaleDateString()}</span></p>
      <p class="ntext">${esc(n.text).replace(/\n/g, '<br>')}</p></section>`).join('')}`).join('')}`);
};
/** The "My note" box at the bottom of the verse breakdown drawer. */
function noteBox(v) {
  const box = document.createElement('div');
  box.className = 'mynote';
  const n = myNotes.find((x) => x.bookId === cur.book && x.chapter === cur.ch && x.verse === v);
  if (!E().enabled) { box.innerHTML = ''; return box; }
  if (!me) { box.innerHTML = `<h4>My note</h4><p class="body">Sign in to write your own notes on this verse.</p><button class="pill" data-signin>Sign in</button>`; return box; }
  // Without Plus the breakdown card above already explains the upgrade; just show any old note.
  if (!plus) { box.innerHTML = n ? `<h4>My note</h4><p class="body">${esc(n.text)}</p>` : ''; return box; }
  const at = { bookId: cur.book, chapter: cur.ch, verse: v };
  box.innerHTML = `<h4>My note</h4><textarea rows="3" maxlength="5000" placeholder="Write a thought, a prayer, a question…">${esc(n ? n.text : '')}</textarea><div class="row"><button class="pill solid" data-save>Save note</button>${n ? '<button class="pill" data-del>Delete</button>' : ''}<span class="saved" aria-live="polite"></span></div>`;
  const ta = box.querySelector('textarea'), msg = box.querySelector('.saved');
  box.querySelector('[data-save]').onclick = () => act(() => E().mutation('notes:save', { ...at, text: ta.value }), null, () => { msg.textContent = ta.value.trim() ? 'Saved' : 'Deleted'; });
  box.querySelector('[data-del]')?.addEventListener('click', () => act(() => E().mutation('notes:save', { ...at, text: '' }), null, () => { ta.value = ''; msg.textContent = 'Deleted'; }));
  return box;
}
// Wrap the reader's verse breakdown so it always ends with the note box.
const _verseInsight = verseInsight;
verseInsight = async function (v) {
  let p;
  if (locked()) {
    // Free readers see the verse and what Elyon Plus adds, without calling the AI.
    document.querySelectorAll('.v.sel').forEach((x) => x.classList.remove('sel')); document.getElementById('v' + v)?.classList.add('sel');
    const b = IDX.books.find((x) => x.id === cur.book), req = verseRequest(v, 'simple');
    openDrawer('ins');
    $('#ins-body').innerHTML = `<div class="ref">${esc(b.name)} ${cur.ch}:${v} · ${esc(cur.tr)}</div><blockquote>${esc(req.verseText)}</blockquote>
      ${plusCard('Double-tap any verse for a plain-language explanation, why it matters, related passages and a deeper look.')}`;
  } else p = _verseInsight(v);
  const body = $('#ins-body');
  body.querySelector('.mynote')?.remove();
  body.appendChild(noteBox(v));
  return p;
};
// Ask Me is part of Elyon Plus.
const _openAsk = openAsk;
openAsk = function () {
  if (!locked()) { $('#ask-form').style.display = ''; return _openAsk(); }
  openDrawer('ask');
  $('#ask-form').style.display = 'none';
  $('#msgs').innerHTML = `<p class="welcome">Ask anything about a subject, a verse, a book, or a word, and get answers that point you to passages you can read here.</p>${plusCard('Ask Me questions about any verse, book or subject.')}`;
};
$('#ask-btn').onclick = () => ($('#ask').classList.contains('open') ? closeDrawer() : openAsk());

// Pencil marks on verses that have a note.
function markNotes() {
  if (!cur.book) return;
  document.querySelectorAll('.text .v').forEach((el) => {
    const has = myNotes.some((n) => n.bookId === cur.book && n.chapter === cur.ch && n.verse === +el.dataset.v);
    el.classList.toggle('has-note', has);
  });
}
new MutationObserver(markNotes).observe($('#main'), { childList: true });

// ------------------------------------------------------------ Elyon Plus
PAGES.plus = async ([sub, sessionId]) => {
  if (sub === 'thanks' && sessionId) {
    page('plus', `<div class="plus-hero"><p class="he big" lang="he" dir="rtl" style="text-align:center">תּוֹדָה</p><h2 class="ph">Thank you!</h2><p class="pintro" id="plus-msg">${me ? 'Confirming your payment…' : 'Signing you in…'}</p></div>`);
    if (!me || plusConfirmed === sessionId) { if (plus) $('#plus-msg').textContent = 'Elyon Plus is unlocked. Enjoy!'; return; }
    plusConfirmed = sessionId;
    try {
      const ok = await E().action('stripe:confirm', { sessionId });
      $('#plus-msg').innerHTML = ok || plus ? 'Elyon Plus is unlocked. <a href="#today">Go to Today</a>' : 'Your payment is still being processed. Elyon Plus will unlock within a few minutes.';
    } catch { $('#plus-msg').textContent = 'Your payment is being processed. Elyon Plus will unlock within a few minutes.'; }
    return;
  }
  const items = [
    ['Ask Me', 'Ask questions about any verse, book or subject, with answers that point you to passages.'],
    ['Verse breakdowns', 'Double-tap any verse for its meaning in plain words, why it matters, related passages and a deeper look.'],
    ['Word for Today and Hebrew worship', 'A daily message from a Hebrew or Messianic teacher and a song of praise sung in Hebrew.'],
    ['Study plans', 'Eight plans, from the Gospels in 30 days to the whole book in a year, with your progress saved.'],
    ['My Notes', 'Write your own notes on any verse, on every device.'],
  ];
  let action;
  if (!E().enabled) action = '<p class="pintro">Elyon Plus will be available soon.</p>';
  else if (plus) action = `<p class="pill solid" style="display:inline-block">${isOwner ? '✓ Owner: full access to everything' : '✓ You have Elyon Plus'}</p>`;
  else if (isApp()) action = `<p class="pintro">Already have Elyon Plus? Sign in with that account to unlock it here.</p>${me ? '' : '<button class="pill solid" data-signin>Sign in</button>'}`;
  else action = `<button class="pill solid" id="buy-plus" style="font-size:16px;padding:12px 28px">${me ? 'Unlock Elyon Plus for $1.99' : 'Create an account to unlock'}</button><p class="plus-free">One payment, yours for life. No subscription. Secure checkout by Stripe.</p>`;
  page('plus', `<div class="plus-hero"><p class="eyebrow">✦ Elyon Plus</p><h2 class="ph">Go deeper into the Book of Elyon</h2>
      ${isApp() || plus ? '' : '<p class="price">$1.99</p><p class="once">once, for life</p>'}${action}</div>
    <ul class="plus-list">${items.map(([t, d]) => `<li><b>${esc(t)}</b>${esc(d)}</li>`).join('')}</ul>
    <p class="plus-free">Always free: all 82 books in every translation, the book introductions, Topics and the Verse for Today.</p>`);
  $('#buy-plus')?.addEventListener('click', async (e) => {
    if (!me) return openSignIn('signUp', 'Create a free account first, so Elyon Plus stays with you on every device.');
    e.target.disabled = true; e.target.textContent = 'Opening secure checkout…';
    await act(async () => { location.href = await E().action('stripe:checkout', {}); }, () => { e.target.disabled = false; e.target.textContent = 'Unlock Elyon Plus for $1.99'; });
  });
};

// ------------------------------------------------------------ Free links (owner)
const giftUrl = (code) => `https://bookofelyon.org/#gift/${code}`;
PAGES.owner = async () => {
  if (!isOwner) return page('owner', `<h2 class="ph">Owner</h2><p class="pintro">This page is only for the site owner. ${me ? '' : 'Please sign in.'}</p>`);
  page('owner', `<h2 class="ph">Owner</h2><p class="pintro">Share Elyon Plus for free. Anyone who opens a free link and signs in gets the full version, Ask Me, verse breakdowns, notes, study plans and the daily videos, at no cost.</p><div id="owner-body"><p class="loading">Loading…</p></div>`);
  let ov, an = null;
  try { ov = await E().query('owner:overview', {}); } catch (e) { $('#owner-body').innerHTML = `<p class="err">${esc(String(e.message).split('\n')[0])}</p>`; return; }
  try { an = await E().query('analytics:overview', { now: Date.now() }); } catch (e) { console.error(e); }
  if (cur.page !== 'owner') return;
  $('#owner-body').innerHTML = `<div id="analytics">${an ? '' : '<p class="sub">Analytics will appear after the next backend deploy.</p>'}</div>`;
  if (an) { OWNER_AN = an; renderAnalytics(); }
  $('#owner-body').insertAdjacentHTML('beforeend', `<h3 class="nh" style="margin-top:28px">Free links</h3>
    <div class="two"><section class="card"><p class="eyebrow">Readers with Elyon Plus</p><p class="ph" style="margin:0">${ov.plusMembers}</p><p class="sub">${ov.paid} paid · ${ov.plusMembers - ov.paid} free</p></section>
      <section class="card"><p class="eyebrow">Free links</p><p class="ph" style="margin:0">${ov.gifts.length}</p><p class="sub">${ov.gifts.reduce((n, g) => n + g.uses, 0)} people used them</p></section></div>
    <section class="card"><p class="eyebrow">Make a free link</p>
      <form id="gift-form" class="row"><input name="label" placeholder="Name it, e.g. Church family" maxlength="80" class="oinput">
        <input name="max" type="number" min="1" placeholder="Limit (empty = unlimited)" class="oinput small"><button class="pill solid">Create link</button></form></section>
    ${ov.gifts.map((g) => `<section class="card gift ${g.active ? '' : 'off'}">
      <div class="row" style="margin:0 0 8px;justify-content:space-between"><b>${esc(g.label)}</b><span class="sub" style="margin:0">${g.uses}${g.maxUses ? ' of ' + g.maxUses : ''} used · ${g.active ? 'On' : 'Off'}</span></div>
      <div class="row" style="margin:0"><input class="oinput link" readonly value="${giftUrl(g.code)}"><button class="pill solid" data-copy="${g.code}">Copy</button><button class="pill" data-share="${g.code}">Share</button>
      <button class="pill" data-toggle="${g.code}|${g.active ? 0 : 1}">${g.active ? 'Turn off' : 'Turn on'}</button></div></section>`).join('')}
    <section class="card"><p class="eyebrow">Give Elyon Plus to an account</p><p class="sub">For someone who already has an account on bookofelyon.org.</p>
      <form id="grant-form" class="row"><input name="email" type="email" required placeholder="their@email.com" class="oinput"><button class="pill solid">Give Elyon Plus</button></form><p id="grant-msg" class="sub"></p></section>`);
  $('#gift-form').onsubmit = (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    act(() => E().mutation('owner:createGift', { label: f.label || '', maxUses: f.max ? +f.max : null }), null, () => { toast('Free link created'); PAGES.owner(); }); };
  $('#grant-form').onsubmit = (e) => { e.preventDefault(); const email = new FormData(e.target).get('email');
    act(async () => { $('#grant-msg').textContent = await E().mutation('owner:grantByEmail', { email }); }); };
};
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-copy]'), sh = e.target.closest('[data-share]'), tg = e.target.closest('[data-toggle]');
  if (c) { navigator.clipboard?.writeText(giftUrl(c.dataset.copy)).then(() => toast('Link copied'), () => toast('Select the link and copy it', true)); }
  if (sh) { const url = giftUrl(sh.dataset.share);
    if (navigator.share) navigator.share({ title: 'The Book of Elyon', text: 'A gift for you: the full Book of Elyon, free.', url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => toast('Link copied')); }
  if (tg) { const [code, on] = tg.dataset.toggle.split('|'); act(() => E().mutation('owner:setGiftActive', { code, active: on === '1' }), null, () => PAGES.owner()); }
});

// ---- Analytics (owner page)
let OWNER_AN = null, AN_PERIOD = 'd30';
const fmt = (n) => n.toLocaleString();
const PAGE_NAMES = { read: 'Reading', today: 'Today', plans: 'Study Plans', plan: 'A study plan', topics: 'Topics', topic: 'A topic', notes: 'My Notes', plus: 'Elyon Plus', cover: 'Cover', contents: 'Contents', references: 'References', credits: 'Credits', gift: 'Free link', privacy: 'Privacy', terms: 'Terms' };
function renderAnalytics() {
  const an = OWNER_AN, box = $('#analytics'); if (!an || !box) return;
  const p = an.periods[AN_PERIOD];
  const days = AN_PERIOD === 'd7' ? 7 : AN_PERIOD === 'd30' ? 30 : 90;
  const series = an.daily.slice(-days);
  const tiles = [
    ['Page views', fmt(p.views)], ['Visitors', fmt(p.visits), 'one per person per day'], ['New visitors', fmt(p.newVisitors)],
    ['New accounts', fmt(p.signups)], ['Paid upgrades', fmt(p.paid), '$' + (p.revenueCents / 100).toFixed(2)], ['Free Plus given', fmt(p.freeGiven)],
    ['Ask Me questions', fmt(p.asks)], ['Verse breakdowns', fmt(p.verses)],
  ];
  const list = (items, name) => items.length ? `<ol class="toplist">${items.slice(0, 8).map((x) => `<li><span>${esc(name(x.key))}</span><i style="width:${Math.max(4, (x.count / items[0].count) * 100)}%"></i><b>${fmt(x.count)}</b></li>`).join('')}</ol>` : '<p class="sub">Nothing yet.</p>';
  box.innerHTML = `
    <div class="row an-head"><h3 class="nh" style="margin:0">Analytics</h3>
      <div class="seg" role="tablist">${[['d7', '7 days'], ['d30', '30 days'], ['d90', '90 days'], ['all', 'All time']].map(([k, l]) => `<button role="tab" aria-selected="${k === AN_PERIOD}" data-period="${k}">${l}</button>`).join('')}</div></div>
    <div class="tiles">${tiles.map(([l, v, sub]) => `<div class="tile"><p class="tl">${l}</p><p class="tv">${v}</p>${sub ? `<p class="ts">${sub}</p>` : ''}</div>`).join('')}</div>
    <section class="card"><div class="row" style="margin:0 0 8px;justify-content:space-between"><p class="eyebrow" style="margin:0">Page views per day${AN_PERIOD === 'all' ? ' · last 90 days' : ''}</p>
      <button class="linkbtn" id="an-table-btn">Show as table</button></div>
      ${barChart(AN_PERIOD === 'all' ? an.daily : series)}
      <div id="an-table" hidden>${dayTable(AN_PERIOD === 'all' ? an.daily : series)}</div></section>
    <div class="two"><section class="card"><p class="eyebrow">Most visited</p>${list(p.pages, (k) => PAGE_NAMES[k] || k)}</section>
      <section class="card"><p class="eyebrow">Most read books</p>${list(p.books, bookName)}</section></div>
    <p class="sub">All time: ${fmt(an.totals.accounts)} accounts · ${fmt(an.totals.plus)} with Elyon Plus · ${fmt(an.totals.notes)} notes · ${fmt(an.totals.activePlans)} study plans started${an.totals.since ? ` · counting visits since ${new Date(an.totals.since + 'T12:00:00Z').toLocaleDateString()}` : ''}. Your own visits aren't counted.</p>`;
  box.querySelectorAll('[data-period]').forEach((b) => b.onclick = () => { AN_PERIOD = b.dataset.period; renderAnalytics(); });
  $('#an-table-btn').onclick = (e) => { const t = $('#an-table'); t.hidden = !t.hidden; e.target.textContent = t.hidden ? 'Show as table' : 'Hide table'; };
  wireChart();
}
function barChart(rows) {
  const W = 600, H = 170, padL = 34, padB = 22, padT = 8, n = rows.length;
  const max = Math.max(4, ...rows.map((r) => r.views));
  const step = Math.pow(10, Math.floor(Math.log10(max))), nice = Math.ceil(max / step) * step;
  const bw = (W - padL) / n, gap = n > 60 ? 1 : 2, barW = Math.max(1, bw - gap);
  const y = (v) => padT + (H - padT - padB) * (1 - v / nice);
  const r = Math.min(4, barW / 2);
  const bars = rows.map((d, i) => {
    const x = padL + i * bw + gap / 2, top = y(d.views), base = H - padB, h = base - top;
    const label = `${new Date(d.date + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: ${fmt(d.views)} views, ${fmt(d.visits)} visitors`;
    const shape = h <= 0 ? '' : h < r ? `<rect x="${x}" y="${top}" width="${barW}" height="${h}" class="bar"/>`
      : `<path class="bar" d="M${x} ${base}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + barW - r}Q${x + barW} ${top} ${x + barW} ${top + r}V${base}Z"/>`;
    return `<g class="hit" data-tip="${esc(label)}"><rect x="${padL + i * bw}" y="${padT}" width="${bw}" height="${H - padT - padB}" fill="transparent"/>${shape}</g>`;
  }).join('');
  const grid = [0, 0.5, 1].map((f) => { const v = Math.round(nice * f), yy = y(v); return `<line x1="${padL}" x2="${W}" y1="${yy}" y2="${yy}" class="grid"/><text x="${padL - 6}" y="${yy + 4}" class="axis" text-anchor="end">${fmt(v)}</text>`; }).join('');
  const lbl = (i, anchor) => `<text x="${padL + i * bw + bw / 2}" y="${H - 6}" class="axis" text-anchor="${anchor}">${new Date(rows[i].date + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</text>`;
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Page views per day">${grid}${bars}${lbl(0, 'start')}${n > 2 ? lbl(Math.floor(n / 2), 'middle') : ''}${lbl(n - 1, 'end')}</svg><div class="tip" hidden></div></div>`;
}
function dayTable(rows) {
  return `<table class="reftab"><thead><tr><th>Date</th><th>Page views</th><th>Visitors</th></tr></thead><tbody>${[...rows].reverse().map((d) => `<tr><td>${new Date(d.date + 'T12:00:00Z').toLocaleDateString()}</td><td>${fmt(d.views)}</td><td>${fmt(d.visits)}</td></tr>`).join('')}</tbody></table>`;
}
function wireChart() {
  const c = document.querySelector('#analytics .chart'); if (!c) return;
  const tip = c.querySelector('.tip');
  c.querySelectorAll('.hit').forEach((g) => {
    const show = () => { const b = g.getBoundingClientRect(), cb = c.getBoundingClientRect(); tip.textContent = g.dataset.tip; tip.hidden = false;
      tip.style.left = Math.min(Math.max(0, b.left - cb.left + b.width / 2 - tip.offsetWidth / 2), cb.width - tip.offsetWidth) + 'px'; g.classList.add('on'); };
    const hide = () => { tip.hidden = true; g.classList.remove('on'); };
    g.addEventListener('mouseenter', show); g.addEventListener('mouseleave', hide); g.addEventListener('click', show);
  });
}

// ---- Counting visits (anonymous; see the Privacy Policy)
let lastTracked = '';
function visitorId() {
  try {
    let id = localStorage.getItem('elyon-v');
    if (!id) { id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join(''); localStorage.setItem('elyon-v', id); }
    return id;
  } catch { return null; }
}
function trackView() {
  if (!E().enabled || isOwner) return;
  const h = location.hash.slice(1) || 'cover', id = h.split('/')[0];
  if (h === lastTracked) return; lastTracked = h;
  const isBook = IDX && IDX.books.some((b) => b.id === id);
  const visitor = visitorId(); if (!visitor) return;
  E().mutation('analytics:track', { visitor, page: isBook ? 'read' : id, ...(isBook ? { book: id } : {}) }).catch(() => {});
}
function trackEvent(event) {
  const visitor = visitorId();
  if (E().enabled && !isOwner && visitor) E().mutation('analytics:track', { visitor, page: 'today', event }).catch(() => {});
}
// Count Ask Me questions and verse breakdowns that succeed.
const _api = api;
api = async function (path, body, retried) {
  const d = await _api(path, body, retried);
  if (!retried) trackEvent(path === '/api/ask' ? 'ask' : body && body.kind === 'deeper' ? 'verse-deeper' : 'verse');
  return d;
};
addEventListener('hashchange', () => setTimeout(trackView, 300));

// The page a free link opens: sign in, then Elyon Plus unlocks.
PAGES.gift = async ([code]) => {
  page('gift', `<div class="plus-hero"><p class="eyebrow">✦ A gift for you</p><h2 class="ph">The full Book of Elyon, free</h2><div id="gift-body"><p class="loading">Opening your gift…</p></div></div>`);
  if (!E().enabled || !code) { $('#gift-body').innerHTML = '<p class="pintro">This link isn’t working right now.</p>'; return; }
  const info = await E().query('owner:giftInfo', { code }).catch(() => null);
  if (cur.page !== 'gift') return;
  const box = $('#gift-body');
  if (!info) { box.innerHTML = '<p class="pintro">This free link isn’t valid. Check that you have the whole link.</p>'; return; }
  if (plus) { box.innerHTML = `<p class="pintro">${giftTried === code ? 'Elyon Plus is unlocked. Enjoy!' : 'You already have Elyon Plus. Enjoy!'}</p><a class="pill solid" href="#today">Go to Today</a>`; return; }
  if (!info.open) { box.innerHTML = '<p class="pintro">This free link has been used up or turned off.</p><a class="pill" href="#plus">See Elyon Plus</a>'; return; }
  if (!me) {
    box.innerHTML = `<p class="pintro">You’ve been given Elyon Plus: Ask Me, verse breakdowns, notes, study plans and daily Hebrew worship, free.<br>Create a free account (or sign in) to claim it.</p>
      <button class="pill solid" id="gift-claim" style="font-size:16px;padding:12px 28px">Create an account to claim</button><p class="plus-free">Already have an account? <a href="javascript:void(0)" data-signin>Sign in</a></p>`;
    $('#gift-claim').onclick = () => openSignIn('signUp', 'Create a free account to claim your gift.');
    return;
  }
  if (giftTried === code) return;
  giftTried = code;
  box.innerHTML = '<p class="loading">Unlocking…</p>';
  try {
    const r = await E().mutation('owner:redeemGift', { code });
    box.innerHTML = r === 'unlocked' || r === 'already' ? '<p class="pintro">Elyon Plus is unlocked. Enjoy!</p><a class="pill solid" href="#today">Go to Today</a>'
      : '<p class="pintro">This free link has been used up or turned off.</p>';
  } catch (e) { giftTried = ''; box.innerHTML = `<p class="err">${esc(String(e.message).split('\n')[0])}</p>`; }
};

// ------------------------------------------------------------ Privacy and Terms
// Required by the app stores. Keep in step with what the site really does.
const CONTACT = 'support@bookofelyon.org';
const UPDATED = 'November 15, 2026';
PAGES.privacy = () => page('privacy', `<div class="legal"><h2 class="ph">Privacy Policy</h2><p class="upd">Last updated ${UPDATED}</p>
  <p>The Book of Elyon (“we”) offers a scripture reader at bookofelyon.org and in our mobile apps. This policy explains what information we collect and how we use it. We do not sell your information, show ads, or use tracking or advertising cookies.</p>
  <h3>Reading without an account</h3>
  <p>You can read every book, the topics and the study plans without an account. We do not ask who you are. Our hosting provider keeps standard server logs (such as IP address and pages requested) for security and reliability.</p>
  <p>To know how the site is used, we count page views anonymously: your browser keeps a random number (not a cookie, and not linked to your name, email or account) so we can count each visitor once a day. We only see totals, such as how many people visited this week and which books are read most. It is never used for advertising and never shared.</p>
  <h3>Your account</h3>
  <ul><li><b>What we store:</b> your name, email address and a securely hashed password (we never see or store your password itself); the notes you write; and which study plan days you have finished.</li>
  <li><b>Why:</b> to sign you in and keep your notes and progress available on any device.</li>
  <li><b>Password reset:</b> if you ask, we email you a one-time code through our email provider, Resend.</li></ul>
  <h3>Elyon Plus payments</h3>
  <p>If you buy Elyon Plus, payment is handled by Stripe on its secure checkout page. We never see or store your card details. We keep a record that your account bought Elyon Plus (the Stripe order number, amount and date) so the upgrade stays unlocked.</p>
  <h3>AI features</h3>
  <p>When you use “Ask Me” or double-tap a verse for a breakdown, the question or verse you send is processed by Anthropic’s Claude AI to write the answer. Ask Me conversations are not saved by us. Verse breakdowns are saved per verse (not per person) so the same explanation can be shown to the next reader. Please don’t include personal details in questions.</p>
  <h3>Videos</h3>
  <p>The Today page shows YouTube videos. Nothing is loaded from YouTube until you tap a video; it then plays through YouTube’s privacy-enhanced mode (youtube-nocookie.com) and Google’s privacy policy applies to that video.</p>
  <h3>Who processes data for us</h3>
  <ul><li>Convex (database and sign-in), United States</li><li>Stripe (payments for Elyon Plus)</li><li>Netlify (website hosting)</li><li>Anthropic (AI answers)</li><li>Resend (password reset emails)</li><li>Google Fonts (typefaces)</li></ul>
  <h3>Deleting your data</h3>
  <p>You can delete your account at any time: sign in, open the account menu (your initial at the top right) and choose <b>Delete account</b>. This permanently removes your account, notes and plan progress right away. You can also email us to ask.</p>
  <h3>Children</h3>
  <p>The Book of Elyon is suitable for all ages, but accounts are intended for people 13 and older. If you believe a child under 13 has created an account, contact us and we will delete it.</p>
  <h3>Changes and contact</h3>
  <p>We will post any changes to this policy on this page. Questions: <a href="mailto:${CONTACT}">${CONTACT}</a>.</p></div>`);
PAGES.terms = () => page('terms', `<div class="legal"><h2 class="ph">Terms of Use</h2><p class="upd">Last updated ${UPDATED}</p>
  <p>By using The Book of Elyon website or apps you agree to these terms.</p>
  <h3>The texts</h3>
  <p>The scripture translations in this edition are in the public domain; see Credits for sources. The arrangement, book introductions, design, logo and software are © The Book of Elyon and may not be copied or republished without permission.</p>
  <h3>Elyon Plus</h3>
  <p>Elyon Plus is a one-time purchase ($1.99 US) that unlocks Ask Me, verse breakdowns, notes, study plans and the daily videos for your account, for as long as the service runs. There is no subscription. If something went wrong with your purchase, email us within 30 days for a refund. Deleting your account also removes the upgrade.</p>
  <h3>AI explanations</h3>
  <p>Ask Me answers and verse breakdowns are generated by AI. They can contain mistakes and are not a substitute for study, pastoral counsel or professional advice. Dates of composition are scholarly estimates and many are disputed.</p>
  <h3>Your account</h3>
  <p>Keep your password private. You are responsible for what you write in your notes. Don’t misuse the service, for example by trying to break it, overload it or access other people’s accounts. We may suspend accounts that do.</p>
  <h3>Videos</h3>
  <p>Daily videos come from third-party YouTube channels. Their content belongs to their creators, and we don’t control it.</p>
  <h3>No warranty</h3>
  <p>The service is provided “as is”, without warranties of any kind. To the extent the law allows, we are not liable for any loss arising from its use.</p>
  <h3>Contact</h3>
  <p><a href="mailto:${CONTACT}">${CONTACT}</a></p></div>`);

// ------------------------------------------------------------ Accounts
function acctButton() {
  const b = $('#acct-btn'); if (!b) return;
  b.hidden = !E().enabled;
  b.textContent = me ? (me.name || me.email).trim().charAt(0).toUpperCase() : 'Sign in';
  b.classList.toggle('avatar', !!me);
  b.setAttribute('aria-label', me ? `Account: ${me.name || me.email}` : 'Sign in');
}
function openSignIn(mode = 'signIn', reason = '') {
  const m = $('#signin');
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="si-h">
    <button class="x" data-x aria-label="Close">×</button>
    <picture><source srcset="/brand/mark-dark.svg" media="(prefers-color-scheme: dark)"><img class="smark" src="/brand/mark.svg" alt=""></picture>
    <h3 id="si-h">${mode === 'signUp' ? 'Create your account' : 'Welcome back'}</h3>
    ${reason ? `<p class="sreason">${esc(reason)}</p>` : ''}
    <form id="si-form">
      ${mode === 'signUp' ? '<label>Your name<input name="name" autocomplete="name" required maxlength="80"></label>' : ''}
      <label>Email<input name="email" type="email" autocomplete="email" required></label>
      <label>Password<input name="password" type="password" autocomplete="${mode === 'signUp' ? 'new-password' : 'current-password'}" minlength="8" required></label>
      ${mode === 'signUp' ? '<p class="hintx">At least 8 characters.</p>' : ''}
      <p class="err" id="si-err" role="alert"></p>
      <button class="pill solid wide" id="si-go">${mode === 'signUp' ? 'Create account' : 'Sign in'}</button>
    </form>
    ${mode === 'signIn' ? '<p class="swap forgot"><a href="javascript:void(0)" data-forgot>Forgot password?</a></p>' : ''}
    <p class="swap">${mode === 'signUp' ? 'Already have an account? <a href="javascript:void(0)" data-mode="signIn">Sign in</a>' : 'New here? <a href="javascript:void(0)" data-mode="signUp">Create an account</a>'}</p>
  </div>`;
  m.hidden = false;
  m.querySelector('input').focus();
  m.querySelector('[data-x]').onclick = closeSignIn;
  m.querySelector('[data-mode]').onclick = (e) => openSignIn(e.target.dataset.mode, reason);
  m.querySelector('[data-forgot]')?.addEventListener('click', () => openReset(m.querySelector('input[name=email]').value));
  $('#si-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    $('#si-go').disabled = true; $('#si-err').textContent = '';
    try { await E().signIn(mode, f); closeSignIn(); toast(mode === 'signUp' ? `Welcome, ${f.name.split(' ')[0]}!` : 'Signed in'); }
    catch (err) { $('#si-err').textContent = err.message; $('#si-go').disabled = false; }
  };
}
/** Forgot password: step 1 emails a code, step 2 sets the new password. */
function openReset(email = '', sent = false) {
  const m = $('#signin');
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="si-h">
    <button class="x" data-x aria-label="Close">×</button>
    <picture><source srcset="/brand/mark-dark.svg" media="(prefers-color-scheme: dark)"><img class="smark" src="/brand/mark.svg" alt=""></picture>
    <h3 id="si-h">${sent ? 'Check your email' : 'Reset your password'}</h3>
    <p class="sreason">${sent ? `We sent an 8-digit code to <b>${esc(email)}</b>. It works for 15 minutes.` : 'Enter your email and we’ll send you a code.'}</p>
    <form id="si-form">
      ${sent ? `<label>Code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{8,9}" maxlength="9" required></label>
        <label>New password<input name="newPassword" type="password" autocomplete="new-password" minlength="8" required></label>
        <p class="hintx">At least 8 characters.</p>`
      : `<label>Email<input name="email" type="email" autocomplete="email" required value="${esc(email)}"></label>`}
      <p class="err" id="si-err" role="alert"></p>
      <button class="pill solid wide" id="si-go">${sent ? 'Set new password' : 'Send code'}</button>
    </form>
    <p class="swap">${sent ? '<a href="javascript:void(0)" data-resend>Send a new code</a> · ' : ''}<a href="javascript:void(0)" data-back>Back to sign in</a></p>
  </div>`;
  m.hidden = false;
  m.querySelector('input').focus();
  m.querySelector('[data-x]').onclick = closeSignIn;
  m.querySelector('[data-back]').onclick = () => openSignIn('signIn');
  m.querySelector('[data-resend]')?.addEventListener('click', () => openReset(email, false));
  $('#si-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    $('#si-go').disabled = true; $('#si-err').textContent = '';
    try {
      if (!sent) { await E().signIn('reset', { email: f.email }); openReset(f.email.trim(), true); }
      else { await E().signIn('reset-verification', { email, code: f.code, newPassword: f.newPassword }); closeSignIn(); toast('Password changed. You’re signed in.'); }
    } catch (err) { $('#si-err').textContent = err.message; $('#si-go').disabled = false; }
  };
}
function closeSignIn() { $('#signin').hidden = true; $('#signin').innerHTML = ''; }
function openAcctMenu() {
  const m = $('#acct-menu');
  if (!m.hidden) { m.hidden = true; return; }
  m.innerHTML = `<p class="who"><b>${esc(me.name || 'Signed in')}</b><br>${esc(me.email)}</p>
    ${isOwner ? '<a href="#owner">⚙ Owner: free links</a>' : ''}<a href="#plus">${plus ? '✦ Elyon Plus ✓' : '✦ Get Elyon Plus'}</a><a href="#notes">My notes</a><a href="#plans">My study plans</a>
    <button data-out>Sign out</button><button class="danger" data-delete>Delete account</button>`;
  m.hidden = false;
  m.querySelector('[data-out]').onclick = async () => { m.hidden = true; await E().signOut(); toast('Signed out'); };
  m.querySelector('[data-delete]').onclick = async () => {
    m.hidden = true;
    if (!confirm('Delete your account and all your notes and plan progress? This cannot be undone.')) return;
    await act(() => E().mutation('users:deleteAccount', {}), null, async () => { await E().signOut(); toast('Your account was deleted'); });
  };
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-signin]')) { e.preventDefault(); openSignIn('signIn'); return; }
  if (e.target.closest('#acct-btn')) { me ? openAcctMenu() : openSignIn('signIn'); return; }
  if (!e.target.closest('#acct-menu')) $('#acct-menu').hidden = true;
  if (e.target.id === 'signin') closeSignIn();
  const v = e.target.closest('.vthumb');
  if (v) v.outerHTML = `<div class="vframe"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.dataset.yt)}?autoplay=1&rel=0" title="Video" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
});
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#signin').hidden) closeSignIn(); });

async function act(fn, onFail, onOk) {
  try { await fn(); onOk && (await onOk()); }
  catch (e) {
    onFail && onFail();
    const m = String(e && e.message || e);
    if (/sign in/i.test(m)) openSignIn('signIn', 'Please sign in to continue.');
    else toast(m.replace(/^.*Uncaught Error:\s*/s, '').split('\n')[0] || 'Something went wrong.', true);
  }
}
function toast(msg, bad) {
  document.querySelectorAll('.toast').forEach((old) => old.remove());
  const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}

function rerender() {
  if (cur.page && PAGES[cur.page === 'plans' && location.hash.startsWith('#plan/') ? 'plan' : cur.page]) route();
  markNotes(); renderPlanToday();
}
function startWatching() {
  unwatch.forEach((u) => u()); unwatch = [];
  plusKnown = false; // a new sign-in: its first hasPlus answer isn't a fresh unlock
  if (!E().enabled) return;
  unwatch.push(E().watch('users:me', {}, (u) => { me = u; acctButton(); rerender(); }));
  unwatch.push(E().watch('notes:mine', {}, (n) => { myNotes = n; markNotes(); if (cur.page === 'notes') PAGES.notes(); }));
  unwatch.push(E().watch('plans:mine', {}, (p) => { myPlans = p; if (cur.page === 'plans' || cur.page === 'today') rerender(); }));
  unwatch.push(E().watch('owner:isOwner', {}, (o) => { isOwner = o; plusTab(); if (cur.page === 'owner' || cur.page === 'plus') rerender(); }, () => { isOwner = false; }));
  unwatch.push(E().watch('billing:hasPlus', {}, (h) => {
    if (h && !plus && plusKnown && cur.page !== 'plus') toast('✦ Elyon Plus is unlocked');
    plus = h; plusKnown = true; plusTab(); rerender();
    if ($('#ask').classList.contains('open')) openAsk();
  }));
}

// ------------------------------------------------------------ routing
function route() {
  const [name, ...rest] = location.hash.slice(1).split('/');
  if (PAGES[name]) { PAGES[name](rest); return true; }
  return false;
}
window.elyonRoute = route;
document.querySelectorAll('#tabs a[data-tab="read"]').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault();
  const last = sessionStorage.getItem('elyon-last');
  location.hash = last || 'contents';
}));
addEventListener('hashchange', () => {
  const id = location.hash.slice(1).split('/')[0];
  if (IDX && IDX.books.some((b) => b.id === id)) { try { sessionStorage.setItem('elyon-last', location.hash.slice(1)); } catch {} markTab('read'); }
  else if (['cover', 'contents', 'references', 'credits', ''].includes(id)) markTab('read');
});

// The Elyon Plus tab: a sales page for free readers; for the owner it becomes the Owner page.
function plusTab() {
  const t = document.querySelector('#tabs a[data-tab="plus"]'); if (!t) return;
  if (isOwner) { t.href = '#owner'; t.dataset.tab = 'plus'; t.textContent = '⚙ Owner'; }
  else { t.href = '#plus'; t.textContent = plus ? '✦ Plus ✓' : '✦ Elyon Plus'; }
}
function boot() {
  acctButton();
  setTimeout(trackView, 2500); // after sign-in has settled, so the owner isn't counted
  if (!PAGES[location.hash.slice(1).split('/')[0]]) markTab('read');
  if (!E().enabled) return;
  E().onAuth((signedIn) => { if (!signedIn) { me = null; myNotes = []; myPlans = []; plus = false; plusKnown = false; isOwner = false; plusTab(); acctButton(); rerender(); } startWatching(); });
}
if (window.Elyon) boot(); else addEventListener('elyon-ready', boot, { once: true });
