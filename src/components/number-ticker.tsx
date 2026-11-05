// Adapted from Magic UI Number Ticker (MIT); see docs/licenses/magicuidesign--magicui.txt.
// Adds Korean formatting, reduced-motion support and a stable screen-reader value.
import { useEffect, useRef } from 'react'
import {
  useInView,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from 'motion/react'
import { number } from '@/lib/report'

export function NumberTicker({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduceMotion = useReducedMotion()
  const inView = useInView(ref, { once: true })
  const motion = useMotionValue(value)
  const spring = useSpring(motion, { damping: 50, stiffness: 180 })
  useEffect(() => {
    if (inView && !reduceMotion) {
      motion.jump(value * 0.88)
      motion.set(value)
    } else if (ref.current) ref.current.textContent = number(value)
  }, [inView, reduceMotion, value, motion])
  useEffect(
    () =>
      spring.on('change', (v) => {
        if (ref.current && !reduceMotion) ref.current.textContent = number(v)
      }),
    [spring, reduceMotion],
  )
  return (
    <>
      <span ref={ref} aria-hidden="true">
        {number(value)}
      </span>
      <span className="sr-only">{number(value)}</span>
    </>
  )
}
