import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

type GrowingGameInputProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { sizeKey: string };

// A game entry is still one phrase; visual wrapping must not introduce newlines into it.
export function GrowingGameInput({ sizeKey, onChange, onKeyDown, ...props }: GrowingGameInputProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = () => {
      element.style.height = 'auto';
      const style = getComputedStyle(element);
      element.style.height = `${element.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)}px`;
    };
    resize();
    let previousWidth = element.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const width = element.getBoundingClientRect().width;
      if (width !== previousWidth) {
        previousWidth = width;
        resize();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [props.value, sizeKey]);

  return (
    <textarea
      {...props}
      className="growing-game-input"
      ref={ref}
      rows={1}
      onChange={(event) => {
        event.currentTarget.value = event.currentTarget.value.replace(/[\r\n]+/g, ' ');
        onChange?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.preventDefault();
        onKeyDown?.(event);
      }}
    />
  );
}
