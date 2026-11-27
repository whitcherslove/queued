import { useEffect, useState } from 'react';
/**
 * The part of the screen you can actually see (minus the keyboard), in pixels.
 * A dialog placed with this stays centred and never slides under the keyboard or jumps when it opens.
 */
export function useVisibleBox() {
  const read = () => { const v = window.visualViewport; return { top: v ? v.offsetTop : 0, height: v ? v.height : window.innerHeight }; };
  const [box, setBox] = useState(read);
  useEffect(() => {
    const v = window.visualViewport; if (!v) return;
    const on = () => setBox(read());
    v.addEventListener('resize', on); v.addEventListener('scroll', on);
    return () => { v.removeEventListener('resize', on); v.removeEventListener('scroll', on); };
  }, []);
  return box;
}
