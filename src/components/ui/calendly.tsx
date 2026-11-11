import { useEffect, useRef, useState } from "react";

const CALENDLY_SCRIPT = "https://assets.calendly.com/assets/external/widget.js";

function getCalendlyUrl(): string {
  const envUrl = (import.meta as any).env?.VITE_CALENDLY_URL;
  return (envUrl && String(envUrl).trim()) || "";
}

export function openCalendlyPopup(url?: string): void {
  const target = (url && url.trim()) || getCalendlyUrl();
  if (!target) return;
  const w = window as any;
  if (typeof w.Calendly === "undefined") {
    const s = document.createElement("script");
    s.src = CALENDLY_SCRIPT;
    s.async = true;
    s.onload = () => {
      try { w.Calendly?.initPopupWidget?.({ url: target }); } catch { /* noop */ }
    };
    document.body.appendChild(s);
  } else {
    try { w.Calendly.initPopupWidget({ url: target }); } catch { /* noop */ }
  }
}

export interface CalendlySchedulerProps {
  url?: string;
  height?: number;
}

export default function CalendlyScheduler({ url, height = 700 }: CalendlySchedulerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bookedRef = useRef(false);
  const [booked, setBooked] = useState(false);
  const [eventTime, setEventTime] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const targetUrl = (url && url.trim()) || getCalendlyUrl();

  useEffect(() => {
    if (!targetUrl) return;
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = "";
    const widget = document.createElement("div");
    widget.className = "calendly-inline-widget";
    widget.setAttribute("data-url", targetUrl);
    widget.style.minWidth = "320px";
    widget.style.height = `${height}px`;
    container.appendChild(widget);

    const script = document.createElement("script");
    script.src = CALENDLY_SCRIPT;
    script.async = true;
    script.onerror = () => setError("Failed to load the scheduling widget. Please try again.");
    container.appendChild(script);

    const handler = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== "object") return;
      const ev = (e.data as any).event;
      if (!ev) return;
      if (ev === "calendly.date_and_time_selected") {
        const payload = (e.data as any).payload || {};
        const start = payload.event_start_time || payload.start_time;
        if (start) {
          try { setEventTime(new Date(start).toLocaleString()); } catch { /* noop */ }
        }
      } else if (ev === "calendly.event_scheduled") {
        if (bookedRef.current) return; // prevent duplicate confirmation
        bookedRef.current = true;
        const payload = (e.data as any).payload || {};
        const start = payload.event_start_time || payload.start_time;
        if (start) {
          try { setEventTime(new Date(start).toLocaleString()); } catch { /* noop */ }
        }
        setBooked(true);
      }
    };
    window.addEventListener("message", handler);

    return () => {
      window.removeEventListener("message", handler);
      if (container) container.innerHTML = "";
    };
  }, [targetUrl, height]);

  if (!targetUrl) {
    return <p className="g-fineprint">Scheduling is not configured.</p>;
  }

  if (booked) {
    return (
      <div className="g-form g-success" role="status" aria-live="polite">
        <div style={{ fontSize: 44 }}>✓</div>
        <h3>Your meeting has been booked.</h3>
        {eventTime && <p className="sec-lede" style={{ marginInline: "auto" }}>Confirmed for {eventTime}.</p>}
        <p className="g-fineprint">A confirmation has been sent to your email by Calendly.</p>
      </div>
    );
  }

  return (
    <div>
      <div ref={containerRef} />
      {error && <p className="g-error" style={{ display: "block" }} role="alert">{error}</p>}
    </div>
  );
}

export function useCalendlyBooking() {
  const [booked, setBooked] = useState(false);
  const [eventTime, setEventTime] = useState<string | null>(null);
  const bookedRef = useRef(false);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== "object") return;
      const ev = (e.data as any).event;
      if (ev === "calendly.date_and_time_selected") {
        const payload = (e.data as any).payload || {};
        const start = payload.event_start_time || payload.start_time;
        if (start) {
          try { setEventTime(new Date(start).toLocaleString()); } catch { /* noop */ }
        }
      } else if (ev === "calendly.event_scheduled") {
        if (bookedRef.current) return;
        bookedRef.current = true;
        const payload = (e.data as any).payload || {};
        const start = payload.event_start_time || payload.start_time;
        if (start) {
          try { setEventTime(new Date(start).toLocaleString()); } catch { /* noop */ }
        }
        setBooked(true);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const reset = () => { bookedRef.current = false; setBooked(false); setEventTime(null); };
  return { booked, eventTime, reset };
}