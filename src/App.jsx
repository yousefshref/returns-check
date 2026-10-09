import { useEffect, useState } from 'react';
import { CONFIG } from './config';
import { STRINGS } from './i18n';

const USAGE_KEY = 'rc_usage';
const HISTORY_KEY = 'rc_history';
const BOSTA_RANKING_URL = 'https://app.bosta.co/api/v2/consignee/ranking';

const todayStr = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage can be blocked in private mode */
  }
}

async function getIp() {
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    const json = await res.json();
    return json.ip || 'unknown';
  } catch {
    return 'unknown';
  }
}

function normalizePhone(raw) {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0020')) digits = '0' + digits.slice(4);
  else if (digits.startsWith('20') && digits.length === 12) digits = '0' + digits.slice(2);
  return digits;
}

const isValidPhone = (digits) => digits.length >= 10 && digits.length <= 15;

const maskPhone = (p) => (p.length > 6 ? `${p.slice(0, 3)}••••${p.slice(-3)}` : p);

// Bosta returns { success, message, data: { consigneRanking: {...} } }
function unwrap(json) {
  return json?.data?.consigneRanking || {};
}

// Turns the Bosta ranking object into one result object.
function analyse(r) {
  const delivered = Number(r.deliveredDeliveriesCount) || 0;
  const cancelled = Number(r.returnedDeliveriesCount) || 0; // returned = cancelled/failed
  const total = delivered + cancelled;
  const rate = total > 0 ? cancelled / total : 0;
  const successRate =
    r.deliverySuccessRate != null && total > 0
      ? Number(r.deliverySuccessRate)
      : total > 0
        ? (delivered / total) * 100
        : 0;
  let level = 'new';
  if (total > 0) level = rate >= 0.5 ? 'high' : rate >= 0.25 ? 'medium' : 'low';
  return {
    total,
    cancelled,
    delivered,
    rate,
    level,
    successRate,
    consecutiveReturns: Number(r.consecutiveReturnedDeliveriesCount) || 0,
    highUnpaid: Boolean(r.hasHighUnpaidFlexshipReturns),
  };
}

function Gauge({ rate }) {
  const pct = Math.min(Math.max(rate, 0), 1) * 100;
  return (
    <div className="gauge" aria-hidden="true">
      <div className="gauge-track">
        <span className="zone zone-low" />
        <span className="zone zone-medium" />
        <span className="zone zone-high" />
      </div>
      <span className="gauge-marker" style={{ insetInlineStart: `${pct}%` }} />
    </div>
  );
}

function ContactButtons({ t }) {
  const wa = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(t.waText)}`;
  const ig = `https://instagram.com/${CONFIG.instagram}`;
  const tt = `https://www.tiktok.com/@${CONFIG.tiktok}`;
  return (
    <div className="contact-row">
      <a className="btn btn-primary" href={wa} target="_blank" rel="noreferrer">
        {t.whatsapp}
      </a>
      <a className="btn btn-ghost" href={ig} target="_blank" rel="noreferrer">
        {t.instagram}
      </a>
      <a className="btn btn-ghost" href={tt} target="_blank" rel="noreferrer">
        {t.tiktok}
      </a>
    </div>
  );
}

export default function App() {
  const [lang, setLang] = useState('ar');
  const t = STRINGS[lang];

  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState('idle'); // idle | loading | result | limit
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [usage, setUsage] = useState(() => readJson(USAGE_KEY, null));
  const [history, setHistory] = useState(() => readJson(HISTORY_KEY, []));

  useEffect(() => {
    document.documentElement.dir = t.dir;
    document.documentElement.lang = lang;
  }, [lang, t.dir]);

  const usedToday = Boolean(usage && usage.date === todayStr());

  async function handleCheck(e) {
    e.preventDefault();
    setError('');

    const clean = normalizePhone(phone);
    if (!isValidPhone(clean)) {
      setError(t.invalidPhone);
      return;
    }
    if (!CONFIG.bostaApiKey) {
      setError(
        t.noApiKey ??
          (lang === 'ar'
            ? 'مفتاح Bosta API غير موجود. أضفه في ملف config.js.'
            : 'Missing Bosta API key. Set bostaApiKey in config.js.')
      );
      return;
    }

    setStatus('loading');
    const ip = await getIp();

    // 1. Is this IP already saved in localStorage for today?
    const saved = readJson(USAGE_KEY, null);
    if (saved && saved.ip === ip && saved.date === todayStr()) {
      setUsage(saved);
      setStatus('limit');
      return;
    }

    // 2. Not saved: save it now, then call the Bosta API.
    const record = { ip, date: todayStr() };
    writeJson(USAGE_KEY, record);
    setUsage(record);

    try {
      const res = await fetch(`${BOSTA_RANKING_URL}?phone=${encodeURIComponent(clean)}`, {
        method: 'GET',
        headers: {
          Authorization: CONFIG.bostaApiKey,
          Accept: 'application/json',
        },
      });

      if (res.status === 429) {
        setStatus('limit'); // rate limited, treat like the daily limit
        return;
      }

      let data = {};
      if (res.status === 404) {
        data = {}; // no orders found for this number, shown as "new"
      } else if (!res.ok) {
        throw new Error(`Bosta returned ${res.status}`);
      } else {
        data = unwrap(await res.json());
      }

      const analysed = analyse(data);

      setResult({ ...analysed, phone: clean });
      const entry = {
        phone: maskPhone(clean),
        level: analysed.level,
        delivered: analysed.delivered,
        returned: analysed.cancelled,
        successRate: Math.round(analysed.successRate),
        date: todayStr(),
      };
      const nextHistory = [entry, ...history].slice(0, 20);
      setHistory(nextHistory);
      writeJson(HISTORY_KEY, nextHistory);
      setPhone('');
      setStatus('result');
    } catch {
      // The request failed, so give the free check back.
      try {
        localStorage.removeItem(USAGE_KEY);
      } catch {
        /* ignore */
      }
      setUsage(null);
      setError(t.requestFailed);
      setStatus('idle');
    }
  }

  const busy = status === 'loading';

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">{t.appName}</div>
        <nav className="nav">
          <a href="#check">{t.navCheck}</a>
          <a href="#history">{t.navHistory}</a>
          <a href="#unlimited">{t.navUnlimited}</a>
        </nav>
        <button
          type="button"
          className="lang-toggle"
          onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
        >
          {t.langToggle}
        </button>
      </aside>

      <main className="main">
        <header className="page-head">
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </header>

        <div className="stats">
          <div className="stat">
            <span className="stat-value">{usedToday ? 0 : 1}</span>
            <span className="stat-label">{t.checksLeft}</span>
          </div>
          <div className="stat">
            <span className="stat-value">{history.length}</span>
            <span className="stat-label">{t.checksRun}</span>
          </div>
        </div>

        <div className="grid">
          <div className="col">
            <section id="check" className="panel">
              <form onSubmit={handleCheck} noValidate>
                <label htmlFor="phone">{t.phoneLabel}</label>
                <div className="field-row">
                  <input
                    id="phone"
                    type="tel"
                    inputMode="tel"
                    dir="ltr"
                    autoComplete="off"
                    placeholder={t.phonePlaceholder}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? 'phone-error' : undefined}
                  />
                  <button className="btn btn-primary" type="submit" disabled={busy}>
                    {busy ? t.loading : t.button}
                  </button>
                </div>
                {error && (
                  <p id="phone-error" className="error" role="alert">
                    {error}
                  </p>
                )}
              </form>
            </section>

            {status === 'result' && result && (
              <section className={`panel result level-${result.level}`} aria-live="polite">
                <div className="result-head">
                  <span className="badge">{t.levels[result.level]}</span>
                  <span className="result-phone" dir="ltr">
                    {maskPhone(result.phone)}
                  </span>
                </div>
                <p className="result-note">{t.notes[result.level]}</p>

                {result.level !== 'new' && <Gauge rate={result.rate} />}

                <dl className="result-stats">
                  <div>
                    <dt>{t.statTotal}</dt>
                    <dd>{result.total}</dd>
                  </div>
                  <div>
                    <dt>{t.statCancelled}</dt>
                    <dd>{result.cancelled}</dd>
                  </div>
                  <div>
                    <dt>{t.statDelivered}</dt>
                    <dd>{result.delivered}</dd>
                  </div>
                  <div>
                    <dt>{t.statRate}</dt>
                    <dd>{Math.round(result.rate * 100)}%</dd>
                  </div>
                </dl>
              </section>
            )}

            {status === 'limit' && (
              <section className="panel limit" aria-live="polite">
                <h2>{t.limitTitle}</h2>
                <p>{t.limitBody}</p>
                <ContactButtons t={t} />
              </section>
            )}
          </div>

          <div className="col">
            <section id="history" className="panel">
              <h2>{t.navHistory}</h2>
              {history.length === 0 ? (
                <p className="empty">{t.historyEmpty}</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>{t.colPhone}</th>
                      <th>{t.colRisk}</th>
                      <th>{t.statDelivered}</th>
                      <th>{t.statCancelled}</th>
                      <th>{t.statRate}</th>
                      <th>{t.colDate}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h, i) => (
                      <tr key={i}>
                        <td dir="ltr" className="num">
                          {h.phone}
                        </td>
                        <td>
                          <span className={`dot dot-${h.level}`} />
                          {t.levels[h.level]}
                        </td>
                        <td dir="ltr" className="num">
                          {h.level === 'new' ? '–' : h.delivered}
                        </td>
                        <td dir="ltr" className="num">
                          {h.level === 'new' ? '–' : h.returned}
                        </td>
                        <td dir="ltr" className="num">
                          {h.level === 'new' || h.successRate == null ? '–' : `${h.successRate}%`}
                        </td>
                        <td dir="ltr" className="num">
                          {h.date}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section id="unlimited" className="panel cta">
              <h2>{t.ctaTitle}</h2>
              <p>{t.ctaBody}</p>
              <ContactButtons t={t} />
            </section>
          </div>
        </div>
      </main>
    </div>
  );
} 