"use client";

import * as React from "react";

/**
 * Runs `onChange` during render when `value` changes. This is React's recommended way to reset or
 * adjust state when a prop changes ("adjusting state while rendering"), avoiding an effect that
 * renders twice. Only call setters of the same component inside `onChange`.
 */
export function useOnChange<T>(value: T, onChange: (next: T, prev: T) => void) {
  const [prev, setPrev] = React.useState(value);
  if (!Object.is(prev, value)) {
    setPrev(value);
    onChange(value, prev);
  }
}
