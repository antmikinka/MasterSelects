import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { IssueCreditCampaignBanner } from '../../src/components/common/IssueCreditCampaignBanner';

describe('IssueCreditCampaignBanner', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the issue credit campaign and GitHub issue action', () => {
    render(<IssueCreditCampaignBanner />);

    expect(screen.getByRole('region', { name: 'MasterSelects issue credit campaign' })).toBeInTheDocument();
    expect(screen.getByText('Completed Issue = 1000 AI Credits')).toBeInTheDocument();

    const issueLink = screen.getByRole('link', { name: /Submit issue/i });
    expect(issueLink).toHaveAttribute('href', 'https://github.com/Sportinger/MasterSelects/issues/new');
    expect(issueLink).toHaveAttribute('target', '_blank');
  });

  it('can be dismissed for the current session', () => {
    render(<IssueCreditCampaignBanner />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss issue credit campaign' }));

    expect(screen.queryByRole('region', { name: 'MasterSelects issue credit campaign' })).not.toBeInTheDocument();
  });
});
