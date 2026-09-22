import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Panel } from './panel';

describe('Panel', () => {
  it('renders a div by default', () => {
    const { container } = render(<Panel>content</Panel>);

    expect(container.firstElementChild?.tagName).toBe('DIV');
  });

  it('can render a semantic landmark instead', () => {
    render(
      <Panel as="section" aria-label="Services">
        content
      </Panel>,
    );

    expect(screen.getByRole('region', { name: 'Services' })).toBeInTheDocument();
  });
});
