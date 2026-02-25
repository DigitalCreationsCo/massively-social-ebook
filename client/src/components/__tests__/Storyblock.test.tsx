import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Storyblock } from '../Storyblock';

describe('Storyblock', () => {
    const mockBlock = {
        id: 1,
        channelId: 'scifi',
        title: 'Test Story',
        content: 'Once upon a time...',
        phase: 'reading' as const,
        imageUrl: 'https://example.com/image.jpg',
        timeRemaining: 30,
        timeToNextDecision: 120,
        initialTimeToNextDecision: 120,
        createdAt: new Date().toISOString(),
        optionA: { label: 'A', description: 'Desc A' },
        optionB: { label: 'B', description: 'Desc B' },
        turnsToNextChoice: 5
    };

    it('positions narrative content at the bottom (justify-end)', () => {
        const { getByText } = render(<Storyblock block={ mockBlock } />);

        // Find the story title and walk up to find the container with centering classes
        const title = getByText('Test Story');
        let container = title.parentElement;
        while (container && !container.classList.contains('justify-end')) {
            container = container.parentElement;
        }

        expect(container).not.toBeNull();
        expect(container).toHaveClass('justify-end');
    });

    it('renders the story content', () => {
        const { getByText } = render(<Storyblock block={ mockBlock } />);
        expect(getByText('Test Story')).toBeInTheDocument();
        expect(getByText('Once upon a time...')).toBeInTheDocument();
    });

    it('renders a waiting state when no block is provided', () => {
        const { getByText } = render(<Storyblock />);
        expect(getByText('Awaiting Story')).toBeInTheDocument();
    });
});
