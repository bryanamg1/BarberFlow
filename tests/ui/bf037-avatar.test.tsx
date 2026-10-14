import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import type { AvatarProps } from '@/components/ui/Avatar';
import { theme } from '@/theme';

// RNTL 14 exposes host nodes through root.queryAll, including decorative images.
function images() {
  return (
    screen.root?.queryAll(
      (node) => Boolean(node.props.source) && node.props.resizeMode === 'cover',
    ) ?? []
  );
}

test.each([
  ['Martín Pérez', 'MP'],
  ['Diego', 'D'],
  ['  María   del Carmen  ', 'MC'],
  ['Élodie Durand', 'ÉD'],
  ['\tJosé\nPérez\u00a0', 'JP'],
  ['𐐨 𐐩', '𐐀𐐁'],
  ['', '?'],
  [' \t\n\u00a0 ', '?'],
])('initials follow the approved Unicode rule for %j', async (label, expected) => {
  await render(<Avatar label={label} />);
  expect(screen.getByText(expected, { includeHiddenElements: true })).toBeOnTheScreen();
  expect(screen.getAllByRole('image')).toHaveLength(1);
});

test('missing or empty URI uses initials and does not create an Image', async () => {
  const rendered = await render(<Avatar label="Martín Pérez" imageUri="" />);
  expect(images()).toHaveLength(0);
  await rendered.rerender(<Avatar label="Martín Pérez" />);
  expect(images()).toHaveLength(0);
  expect(screen.getByText('MP', { includeHiddenElements: true })).toBeOnTheScreen();
});

test('supplied image uses its unchanged URI and falls back after a load error', async () => {
  const imageUri = 'https://images.example.test/avatar.png';
  await render(<Avatar label="Martín Pérez" imageUri={imageUri} />);
  const image = images()[0];
  expect(image.props.source).toEqual({ uri: imageUri });
  expect(image.props.resizeMode).toBe('cover');
  expect(screen.queryByText('MP', { includeHiddenElements: true })).toBeNull();
  await fireEvent(image, 'error', { nativeEvent: { error: 'simulated image failure' } });
  expect(images()).toHaveLength(0);
  expect(screen.getByText('MP', { includeHiddenElements: true })).toBeOnTheScreen();
  expect(screen.getByRole('image', { name: 'Martín Pérez' })).toBeOnTheScreen();
});

test('a new URI retries and a late error from the old image cannot hide it', async () => {
  const rendered = await render(<Avatar label="Ana" imageUri="old-image" />);
  const oldError = images()[0].props.onError;
  await fireEvent(images()[0], 'error', { nativeEvent: { error: 'failed' } });
  expect(screen.getByText('A', { includeHiddenElements: true })).toBeOnTheScreen();
  await rendered.rerender(<Avatar label="Bruno" imageUri="new-image" />);
  expect(images()[0].props.source).toEqual({ uri: 'new-image' });
  await act(() => oldError({ nativeEvent: { error: 'late old failure' } }));
  expect(images()[0].props.source).toEqual({ uri: 'new-image' });
  expect(screen.queryByText('B', { includeHiddenElements: true })).toBeNull();
});

test('changing the label after failure updates initials without retrying the same URI', async () => {
  const rendered = await render(<Avatar label="Ana" imageUri="broken" />);
  await fireEvent(images()[0], 'error', { nativeEvent: { error: 'failed' } });
  await rendered.rerender(<Avatar label="Élodie Durand" imageUri="broken" />);
  expect(images()).toHaveLength(0);
  expect(screen.getByText('ÉD', { includeHiddenElements: true })).toBeOnTheScreen();
});

test.each([
  ['  Martín Pérez  ', undefined, '  Martín Pérez  '],
  ['Martín Pérez', 'Foto de Martín', 'Foto de Martín'],
  ['Martín Pérez', ' \t ', 'Martín Pérez'],
  ['', undefined, 'Avatar'],
  [' \t ', '', 'Avatar'],
])(
  'one accessible image uses the approved label fallback %j / %j',
  async (label, accessibilityLabel, spoken) => {
    await render(<Avatar label={label} accessibilityLabel={accessibilityLabel} />);
    expect(screen.getByRole('image', { name: spoken })).toBeOnTheScreen();
    expect(screen.getAllByRole('image')).toHaveLength(1);
    expect(screen.queryByText(label === 'Martín Pérez' ? 'MP' : '?')).toBeNull();
    const hidden = screen.root?.queryAll((node) => node.props['aria-hidden'] === true)[0];
    expect(hidden?.props.accessibilityElementsHidden).toBe(true);
    expect(hidden?.props.importantForAccessibility).toBe('no-hide-descendants');
  },
);

test('fixed token size/radius and Inter survive additional layout styles', async () => {
  await render(
    <Avatar label="Ana" style={{ margin: theme.spacing[8], width: 100, borderRadius: 0 }} />,
  );
  const root = screen.getByRole('image', { name: 'Ana' });
  expect(StyleSheet.flatten(root.props.style)).toMatchObject({
    width: theme.sizing.touchTarget,
    height: theme.sizing.touchTarget,
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
    margin: theme.spacing[8],
    backgroundColor: theme.colors.surfaceStrong,
  });
  expect(
    StyleSheet.flatten(screen.getByText('A', { includeHiddenElements: true }).props.style),
  ).toEqual({
    ...theme.typography.bodyMedium,
    color: theme.colors.textPrimary,
  });
});

// Compile-time API boundary: only the four approved props are public.
const publicFields: Record<keyof AvatarProps, true> = {
  label: true,
  imageUri: true,
  accessibilityLabel: true,
  style: true,
};
test('public prop surface is the approved small contract', () => {
  expect(Object.keys(publicFields).sort()).toEqual([
    'accessibilityLabel',
    'imageUri',
    'label',
    'style',
  ]);
});
