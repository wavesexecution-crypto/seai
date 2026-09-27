interface MarkProps {
  className?: string;
}

function Base({ className, children }: MarkProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function RestaurantMark({ className }: MarkProps) {
  return (
    <Base className={className}>
      <path d="M4 16h16" />
      <path d="M5 16a7 7 0 0 1 14 0" />
      <path d="M12 9V7.5" />
      <circle cx="12" cy="6.4" r="0.9" />
    </Base>
  );
}

/** Cup on a saucer with rising steam — reads as "cafe" beside the cloche. */
export function CafeMark({ className }: MarkProps) {
  return (
    <Base className={className}>
      <path d="M4.5 9h11v5.5a4 4 0 0 1-4 4h-3a4 4 0 0 1-4-4V9Z" />
      <path d="M15.5 10.5H17a2.5 2.5 0 0 1 0 5h-1.5" />
      <path d="M3 21h14" />
      <path d="M8 6.5c0-.8.8-1 .8-1.8S8 3 8 2.5" />
      <path d="M12 6.5c0-.8.8-1 .8-1.8S12 3 12 2.5" />
    </Base>
  );
}

export function GymMark({ className }: MarkProps) {
  return (
    <Base className={className}>
      <path d="M7 8v8M17 8v8M4 10v4M20 10v4M7 12h10" />
    </Base>
  );
}

export function SalonMark({ className }: MarkProps) {
  return (
    <Base className={className}>
      <circle cx="6.5" cy="6.5" r="2.2" />
      <circle cx="6.5" cy="17.5" r="2.2" />
      <path d="M8.2 7.8 20 19M8.2 16.2 20 5" />
    </Base>
  );
}

export function ClinicMark({ className }: MarkProps) {
  return (
    <Base className={className}>
      <path d="M12 5v14M5 12h14" />
    </Base>
  );
}

export function RealEstateMark({ className }: MarkProps) {
  return (
    <Base className={className}>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6.5 10v9.5h11V10" />
    </Base>
  );
}

export function BusinessMark({ className }: MarkProps) {
  return (
    <Base className={className}>
      <rect x="4" y="8" width="16" height="11" rx="1.5" />
      <path d="M9 8V6.5A1.5 1.5 0 0 1 10.5 5h3A1.5 1.5 0 0 1 15 6.5V8" />
      <path d="M4 12.5h16" />
    </Base>
  );
}
