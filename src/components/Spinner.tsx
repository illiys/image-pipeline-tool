type Props = {
  className?: string
  size?: number
}

export function Spinner({ className = '', size = 16 }: Props) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-accent/30 border-t-accent ${className}`}
      style={{ width: size, height: size }}
    />
  )
}
