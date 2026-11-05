// Preserve Meta's numeric IDs without rounding 64-bit IDs through a JS Number.
export function parseInstagramJson(text: string): unknown {
  return JSON.parse(text, (key, value, context?: { source?: string }) => {
    if ((key === 'id' || key === 'user_id') && typeof value === 'number') {
      if (context?.source && /^\d+$/.test(context.source)) return context.source
      if (Number.isSafeInteger(value) && value >= 0) return String(value)
      throw new Error('unsafe_numeric_id')
    }
    return value
  })
}
