import { useEffect, useRef } from 'react'

/** setInterval bound to component lifetime; callback kept in a ref. */
export function useInterval(cb: () => void, ms: number): void {
  const ref = useRef(cb)
  useEffect(() => {
    ref.current = cb
  })
  useEffect(() => {
    const id = setInterval(() => ref.current(), ms)
    return () => clearInterval(id)
  }, [ms])
}
