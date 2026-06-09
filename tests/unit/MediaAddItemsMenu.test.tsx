import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MediaAddItemsMenu } from '../../src/components/panels/media/import/MediaAddItemsMenu';

type MediaAddItemsMenuComponentProps = ComponentProps<typeof MediaAddItemsMenu>;

function renderMenu(overrides: Partial<MediaAddItemsMenuComponentProps> = {}) {
  const props: MediaAddItemsMenuComponentProps = {
    variant: 'dropdown',
    onClose: vi.fn(),
    onImport: vi.fn(),
    onNewComposition: vi.fn(),
    onNewFolder: vi.fn(),
    onNewText: vi.fn(),
    onNewSolid: vi.fn(),
    onNewMesh: vi.fn(),
    onNewText3D: vi.fn(),
    onNewCamera: vi.fn(),
    onNewSplatEffector: vi.fn(),
    onImportGaussianSplat: vi.fn(),
    onNewMathScene: vi.fn(),
    onNewMotionShape: vi.fn(),
    ...overrides,
  };

  render(<MediaAddItemsMenu {...props} />);
  return props;
}

describe('MediaAddItemsMenu import surface', () => {
  it('delegates Import files to the shared import command', () => {
    const props = renderMenu();

    fireEvent.click(screen.getByText('Import files...'));

    expect(props.onImport).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
