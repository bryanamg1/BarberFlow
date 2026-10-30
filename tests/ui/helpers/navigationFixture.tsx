import * as React from 'react';
import { Pressable, Text, View } from 'react-native';

export type TestTabScreen = {
  name: string;
  options: { title: string; tabBarButton?: () => React.ReactNode };
};

// Navigator boundary only: the real host owns its trigger/state and the default
// tab action remains observable independently of Quick Action.
export function NavigationTabsDouble({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = React.useState('agenda');
  return (
    <View>
      {React.Children.toArray(children).map((child) => {
        if (!React.isValidElement<TestTabScreen>(child)) return null;
        const { name, options } = child.props;
        if (options.tabBarButton) return <View key={name}>{options.tabBarButton()}</View>;
        return (
          <Pressable
            key={name}
            role="tab"
            aria-label={options.title}
            accessibilityState={{ selected: selected === name }}
            onPress={() => setSelected(name)}
          >
            <Text>{options.title}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
