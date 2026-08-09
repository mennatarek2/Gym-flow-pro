import { useId, useMemo, useRef } from 'react'

interface OtpInputProps {
  value: string
  onChange: (value: string) => void
  length?: number
  disabled?: boolean
  autoFocus?: boolean
  'aria-label'?: string
}

export function OtpInput({
  value,
  onChange,
  length = 6,
  disabled,
  autoFocus,
  'aria-label': ariaLabel = 'One-time code',
}: OtpInputProps) {
  const id = useId()
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const digits = useMemo(() => {
    const chars = value.replace(/\D/g, '').slice(0, length).split('')
    while (chars.length < length) chars.push('')
    return chars
  }, [value, length])

  function setAt(index: number, char: string) {
    const next = digits.map((d, i) => (i === index ? char : d))
    onChange(next.join(''))
  }

  return (
    <div className="flex gap-2" role="group" aria-label={ariaLabel}>
      {digits.map((digit, index) => (
        <input
          key={`${id}-${index}`}
          ref={(el) => {
            refs.current[index] = el
          }}
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          disabled={disabled}
          autoFocus={autoFocus && index === 0}
          value={digit}
          aria-label={`Digit ${index + 1}`}
          className="h-12 w-10 rounded-[var(--radius)] border border-slate-600 bg-slate-900 text-center text-lg text-slate-100 focus:border-sky-400"
          onChange={(e) => {
            const raw = e.target.value.replace(/\D/g, '')
            if (!raw) {
              setAt(index, '')
              return
            }
            setAt(index, raw.slice(-1))
            refs.current[index + 1]?.focus()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !digits[index] && index > 0) {
              refs.current[index - 1]?.focus()
            }
          }}
          onPaste={(e) => {
            e.preventDefault()
            const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length)
            onChange(pasted)
            refs.current[Math.min(pasted.length, length) - 1]?.focus()
          }}
        />
      ))}
    </div>
  )
}
