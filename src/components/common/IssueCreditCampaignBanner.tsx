import { useState, type CSSProperties } from 'react';
import { IconExternalLink, IconX } from '@tabler/icons-react';
import './IssueCreditCampaignBanner.css';

const ISSUE_CAMPAIGN_URL = 'https://github.com/Sportinger/MasterSelects/issues/new';

const CONFETTI_COLORS = [
  '#ffcc33',
  '#ff5f6d',
  '#22d3ee',
  '#34d399',
  '#a78bfa',
  '#fb7185',
  '#f97316',
  '#4ade80',
];

const CONFETTI_PIECES = Array.from({ length: 64 }, (_, index) => ({
  color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
  delay: (index % 16) * 0.055,
  drift: ((index * 17) % 96) - 48,
  duration: 1.9 + (index % 9) * 0.11,
  height: 8 + (index % 4) * 4,
  rotate: ((index * 41) % 180) - 90,
  width: 5 + (index % 3) * 2,
  x: 3 + ((index * 29) % 94),
}));

export function IssueCreditCampaignBanner() {
  const [isVisible, setIsVisible] = useState(true);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="issue-credit-campaign" role="region" aria-label="MasterSelects issue credit campaign">
      <div className="issue-credit-campaign-confetti" aria-hidden="true">
        {CONFETTI_PIECES.map((piece, index) => (
          <span
            key={`${piece.x}-${piece.drift}-${index}`}
            className="issue-credit-campaign-confetti-piece"
            style={{
              '--issue-confetti-color': piece.color,
              '--issue-confetti-delay': `${piece.delay}s`,
              '--issue-confetti-drift': `${piece.drift}px`,
              '--issue-confetti-duration': `${piece.duration}s`,
              '--issue-confetti-height': `${piece.height}px`,
              '--issue-confetti-rotate': `${piece.rotate}deg`,
              '--issue-confetti-width': `${piece.width}px`,
              '--issue-confetti-x': `${piece.x}%`,
            } as CSSProperties}
          />
        ))}
      </div>

      <section className="issue-credit-campaign-banner" aria-label="Version 2.0 issue campaign">
        <div className="issue-credit-campaign-version" aria-hidden="true">
          <span>MS</span>
          <strong>2.0</strong>
        </div>

        <div className="issue-credit-campaign-copy">
          <span className="issue-credit-campaign-kicker">Issue Campaign</span>
          <strong>Completed Issue = 1000 AI Credits</strong>
          <p>
            Submit an issue. When we mark it completed, you get 1000 AI credits.
          </p>
        </div>

        <a
          className="issue-credit-campaign-action"
          href={ISSUE_CAMPAIGN_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          <span>Submit issue</span>
          <IconExternalLink size={14} stroke={2.2} aria-hidden="true" />
        </a>

        <button
          type="button"
          className="issue-credit-campaign-close"
          aria-label="Dismiss issue credit campaign"
          onClick={() => setIsVisible(false)}
        >
          <IconX size={15} stroke={2.4} aria-hidden="true" />
        </button>
      </section>
    </div>
  );
}
