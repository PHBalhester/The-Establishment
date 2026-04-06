'use client';

interface TokenDisplayProps {
  name: string;
  symbol: string;
  value: string;
  color: 'bribe' | 'corupt' | 'votes';
}

const tokenColors = {
  bribe: {
    bg: 'bg-government-bribe/10',
    border: 'border-government-bribe',
    text: 'text-government-bribe',
  },
  corupt: {
    bg: 'bg-government-corupt/10',
    border: 'border-government-corupt',
    text: 'text-government-corupt',
  },
  votes: {
    bg: 'bg-government-votes/10',
    border: 'border-government-votes',
    text: 'text-government-votes',
  },
};

export function TokenDisplay({ name, symbol, value, color }: TokenDisplayProps) {
  const colors = tokenColors[color];

  return (
    <div className={`${colors.bg} border ${colors.border} rounded-lg p-4 backdrop-blur-sm`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-government-text-muted font-mono uppercase tracking-wider">
            {name}
          </p>
          <p className={`text-2xl font-bold ${colors.text} font-serif mt-1`}>
            {symbol}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg text-government-text font-mono font-semibold">
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}
