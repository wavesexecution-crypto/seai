import { useEffect, useRef, useState } from "react";

const CAL_EMBED = "https://app.cal.com/embed/embed.js";
const DEFAULT_URL = "https://cal.com/buildwithseai/30min";

function getCalUrl(): string {
  const env = (import.meta as any).env?.VITE_CALCOM_URL;
  return (env && String(env).trim()) || DEFAULT_URL;
}

function toCalLink(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\/+/, "");
  } catch {
    return url.replace(/^https?:\/\/[^/]+\//, "");
  }
}

export interface CalPrefill {
  name?: string;
  email?: string;
}

export function openCalPopup(url?: string, prefill?: CalPrefill): void {
  const target = (url && url.trim()) || getCalUrl();
  const calLink = toCalLink(target);
  if (!calLink) return;
  const w = window as any;
  const run = () => {
    try {
      w.Cal("init", "https://app.cal.com");
      const config: Record<string, any> = {};
      if (prefill?.name) config.name = prefill.name;
      if (prefill?.email) config.email = prefill.email;
      w.Cal("modal", { calLink, ...(Object.keys(config).length ? { config } : {}) });
    } catch { /* noop */ }
  };
  if (typeof w.Cal === "undefined") {
    const s = document.createElement("script");
    s.src = CAL_EMBED;
    s.async = true;
    s.onload = run;
    document.body.appendChild(s);
  } else {
    run();
  }
}

export default function CalComScheduler({ url, height = 700 }: { url?: string; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bookedRef = useRef(false);
  const [booked, setBooked] = useState(false);
  const [eventTime, setEventTime] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const targetUrl = (url && url.trim()) || getCalUrl();
  const calLink = toCalLink(targetUrl);

  useEffect(() => {
    if (!calLink) return;
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = "";
    const calId = "cal-inline-" + Math.random().toString(36).slice(2);
    const div = document.createElement("div");
    div.id = calId;
    div.style.width = "100%";
    div.style.height = `${height}px`;
    div.style.overflow = "auto";
    container.appendChild(div);

    const w = window as any;
    const init = () => {
      try {
        w.Cal("init", "https://app.cal.com");
        w.Cal("inline", { elementOrSelector: `#${calId}`, calLink });
        w.Cal("on", {
          action: "bookingSuccessful",
          callback: (e: any) => {
            if (bookedRef.current) return;
            bookedRef.current = true;
            const data = e?.detail?.data || e?.data || {};
            const start = data.startTime || data.start || data.booking?.startTime;
            if (start) {
              try { setEventTime(new Date(start).toLocaleString()); } catch { /* noop */ }
            }
            setBooked(true);
            setLoading(false);
          },
        });
        setLoading(false);
      } catch {
        setError("Failed to load the scheduling widget. Please try again.");
        setLoading(false);
      }
    };

    if (typeof w.Cal === "undefined") {
      const s = document.createElement("script");
      s.src = CAL_EMBED;
      s.async = true;
      s.onload = init;
      s.onerror = () => { setError("Failed to load the scheduling widget. Please try again."); setLoading(false); };
      document.body.appendChild(s);
    } else {
      init();
    }

    return () => {
      if (container) container.innerHTML = "";
    };
  }, [calLink, height]);

  if (!calLink) {
    return <p className="g-fineprint">Scheduling is not configured.</p>;
  }

  if (booked) {
    return (
      <div className="g-form g-success" role="status" aria-live="polite">
        <div style={{ fontSize: 44 }}>✓</div>
        <h3>Your meeting has been booked.</h3>
        {eventTime && <p className="sec-lede" style={{ marginInline: "auto" }}>Confirmed for {eventTime}.</p>}
        <p className="g-fineprint">A confirmation has been sent to your email by Cal.com.</p>
      </div>
    );
  }

  return (
    <div>
      {loading && <p className="g-fineprint">Loading scheduler…</p>}
      <div ref={containerRef} />
      {error && <p className="g-error" style={{ display: "block" }} role="alert">{error}</p>}
    </div>
  );
}

export function useCalBooking() {
  const [booked, setBooked] = useState(false);
  const [eventTime, setEventTime] = useState<string | null>(null);
  const bookedRef = useRef(false);

  useEffect(() => {
    const w = window as any;
    const register = () => {
      try {
        w.Cal("on", {
          action: "bookingSuccessful",
          callback: (ev: any) => {
            if (bookedRef.current) return;
            bookedRef.current = true;
            const data = ev?.detail?.data || ev?.data || {};
            const start = data.startTime || data.start || data.booking?.startTime;
            if (start) {
              try { setEventTime(new Date(start).toLocaleString()); } catch { /* noop */ }
            }
            setBooked(true);
          },
        });
      } catch { /* noop */ }
    };
    if (typeof w.Cal === "undefined") {
      const s = document.createElement("script");
      s.src = CAL_EMBED;
      s.async = true;
      s.onload = () => { try { w.Cal("init", "https://app.cal.com"); register(); } catch { /* noop */ } };
      document.body.appendChild(s);
    } else {
      try { w.Cal("init", "https://app.cal.com"); } catch { /* noop */ }
      register();
    }
    return () => { /* noop */ };
  }, []);

  const reset = () => { bookedRef.current = false; setBooked(false); setEventTime(null); };
  return { booked, eventTime, reset };
}