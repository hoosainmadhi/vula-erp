import { code39 } from '../lib/barcode';

/**
 * Printable Code 39 barcode. The SVG scales to its container and prints cleanly.
 */
export default function Barcode({
  value,
  height = 48,
  showValue = true,
  className = '',
}: {
  value: string;
  height?: number;
  showValue?: boolean;
  className?: string;
}) {
  const pattern = code39(value);

  return (
    <div className={`inline-flex flex-col items-center ${className}`}>
      <svg
        role="img"
        aria-label={`Barcode ${pattern.value}`}
        viewBox={`0 0 ${pattern.width} 50`}
        preserveAspectRatio="none"
        style={{ height, width: '100%' }}
        className="block"
      >
        <rect x={0} y={0} width={pattern.width} height={50} fill="#ffffff" />
        {pattern.bars.map((bar) => (
          <rect key={bar.x} x={bar.x} y={0} width={bar.width} height={50} fill="#000000" />
        ))}
      </svg>
      {showValue ? (
        <span className="mt-1 font-mono text-[10px] tracking-[0.2em] text-slate-700">
          {pattern.value}
        </span>
      ) : null}
    </div>
  );
}
