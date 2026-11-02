import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import { Dimensions, StyleSheet, Text, TextInput, View } from 'react-native';

import { ResponsiveContainer } from '@/components/layout/ResponsiveContainer';
import { ResponsiveColumns } from '@/components/layout/ResponsiveColumns';
import { useWideLayout } from '@/components/layout/useWideLayout';
import { layout, theme } from '@/theme';

const original = Dimensions.get('window');
const resize = async (width: number) => {
  await act(() => Dimensions.set({ window: { ...original, width } }));
};
afterEach(async () => resize(original.width));

test('D09 dimensions have one canonical theme export', () => {
  expect(layout).toEqual({ wide: 768, contentMaxWidth: 1200 });
  expect(theme.layout).toBe(layout);
});

test.each([320, 390, 767, 768, 1024, 1200, 1280])(
  'container and columns adapt at width %s with existing gutters and preserved children',
  async (width) => {
    await resize(width);
    await render(
      <ResponsiveContainer
        testID="container"
        accessibilityLabel="Contenido"
        style={{ paddingTop: theme.spacing[24] }}
      >
        <ResponsiveColumns testID="columns">
          <Text>Primero</Text>
          <Text>Segundo</Text>
          <Text>Tercero</Text>
        </ResponsiveColumns>
      </ResponsiveContainer>,
    );
    const container = screen.getByTestId('container');
    expect(container.type).toBe('View');
    expect(container.props.accessibilityLabel).toBe('Contenido');
    expect(StyleSheet.flatten(container.props.style)).toMatchObject({
      width: '100%',
      alignSelf: 'center',
      minWidth: 0,
      paddingHorizontal: theme.spacing[16],
      paddingTop: theme.spacing[24],
      maxWidth: width >= 768 ? 1200 : undefined,
    });
    const row = screen.getByTestId('columns').children[0];
    if (typeof row === 'string') throw new Error('Expected native layout row');
    expect(StyleSheet.flatten(row.props.style).flexDirection).toBe(width >= 768 ? 'row' : 'column');
    expect(screen.getAllByText(/Primero|Segundo|Tercero/).map((n) => n.props.children)).toEqual([
      'Primero',
      'Segundo',
      'Tercero',
    ]);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  },
);

test('actual dimension events update layout without remounting stateful children', async () => {
  let mounts = 0;
  function Field() {
    const [value, setValue] = useState('');
    useEffect(() => {
      mounts++;
    }, []);
    return <TextInput accessibilityLabel="Nombre" value={value} onChangeText={setValue} />;
  }
  function Indicator() {
    return <Text>{useWideLayout() ? 'desktop' : 'mobile'}</Text>;
  }
  await resize(767);
  await render(
    <ResponsiveContainer testID="container">
      <ResponsiveColumns>
        <Field />
        <Indicator />
      </ResponsiveColumns>
    </ResponsiveContainer>,
  );
  await fireEvent.changeText(screen.getByLabelText('Nombre'), 'Martín');
  expect(screen.getByText('mobile')).toBeOnTheScreen();
  await resize(768);
  expect(screen.getByText('desktop')).toBeOnTheScreen();
  expect(screen.getByLabelText('Nombre').props.value).toBe('Martín');
  expect(mounts).toBe(1);
  await resize(320);
  expect(screen.getByText('mobile')).toBeOnTheScreen();
  expect(screen.getByLabelText('Nombre').props.value).toBe('Martín');
  expect(mounts).toBe(1);
});

test('empty layout remains a native View without introducing semantics', async () => {
  await render(<ResponsiveColumns testID="empty" style={{ marginTop: theme.spacing[8] }} />);
  expect(screen.getByTestId('empty').type).toBe('View');
  expect(screen.getByTestId('empty').props.role).toBeUndefined();
  expect(StyleSheet.flatten(screen.getByTestId('empty').props.style).marginTop).toBe(
    theme.spacing[8],
  );
});
