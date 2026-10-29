import { digits, type HMS } from '@/lib/hours'
import { Input } from './ui'

/** Hours, minutes and seconds in three small fields; only digits go in. */
export function DurationInput({ label, value, onChange, disabled }: { label: string; value: HMS; onChange: (v: HMS) => void; disabled?: boolean }) {
  const part = (key: keyof HMS, unit: string, name: string, max?: number) => (
    <label className="flex items-center gap-1">
      <Input
        aria-label={`${label}: ${name}`}
        inputMode="numeric"
        className="w-16"
        maxLength={max === undefined ? 5 : 2}
        value={value[key]}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, [key]: digits(e.target.value) })}
      />
      <span className="text-muted">{unit}</span>
    </label>
  )
  return (
    <fieldset className="flex flex-col gap-1 text-sm">
      <legend className="mb-1 font-medium">{label}</legend>
      <div className="flex flex-wrap items-center gap-2">
        {part('h', 'ч', 'часы')}
        {part('m', 'мин', 'минуты', 59)}
        {part('s', 'с', 'секунды', 59)}
      </div>
    </fieldset>
  )
}
