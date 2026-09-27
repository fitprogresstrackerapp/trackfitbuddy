/** First focusable element: lets keyboard users jump past the navigation. */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only z-50 rounded-sm bg-primary px-3 py-2 label-mono text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
    >
      Skip to content
    </a>
  )
}
