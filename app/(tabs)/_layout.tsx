import { View, TouchableOpacity, StyleSheet, Platform, Text } from 'react-native';
import { Redirect, Tabs, router } from 'expo-router';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useAuthStore } from '@stores/authStore';
import { Colors } from '@constants/colors';

// ── Custom Tab Bar ─────────────────────────────────────────────────────────────

const TAB_DEFS = [
  { name: 'home',     icon: 'home',          iconOff: 'home-outline',         label: 'ホーム'  },
  { name: 'radio',    icon: 'radio',          iconOff: 'radio-outline',         label: '放送'    },
  null, // center placeholder
  { name: 'memory',   icon: 'bookmark',       iconOff: 'bookmark-outline',      label: 'ライブラリ' },
  { name: 'settings', icon: 'person',         iconOff: 'person-outline',        label: 'プロフィール' },
];

function CustomTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  // Map route names to their positions in TAB_DEFS (excluding center null)
  const routeNames = state.routes.map((r) => r.name);

  return (
    <View style={tab.wrap}>
      <View style={tab.shadow}>
        <BlurView intensity={90} tint="light" style={StyleSheet.absoluteFill} />
        <View style={tab.tint} pointerEvents="none" />

        <View style={tab.row}>
          {TAB_DEFS.map((def, i) => {
            // Center button
            if (!def) {
              return (
                <TouchableOpacity
                  key="create"
                  style={tab.createBtn}
                  activeOpacity={0.85}
                  onPress={() => router.push('/deepcast')}
                >
                  <Ionicons name="add" size={28} color="#fff" />
                </TouchableOpacity>
              );
            }

            const routeIndex = routeNames.indexOf(def.name);
            if (routeIndex === -1) return null;

            const focused = state.index === routeIndex;
            const color   = focused ? Colors.brand.primary : Colors.text.tertiary;

            return (
              <TouchableOpacity
                key={def.name}
                style={tab.item}
                activeOpacity={0.7}
                onPress={() => {
                  const event = navigation.emit({
                    type: 'tabPress',
                    target: state.routes[routeIndex].key,
                    canPreventDefault: true,
                  });
                  if (!event.defaultPrevented) {
                    navigation.navigate(def.name);
                  }
                }}
              >
                <Ionicons
                  name={(focused ? def.icon : def.iconOff) as any}
                  size={22}
                  color={color}
                />
                <Text style={[tab.label, { color }]}>{def.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const tab = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  shadow: {
    overflow: 'hidden',
    borderTopWidth: 1,
    borderTopColor: 'rgba(200,210,240,0.40)',
    shadowColor: '#7090CC',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 12,
  },
  tint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.20)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: Platform.select({ ios: 28, android: 12 }),
    paddingHorizontal: 8,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingVertical: 4,
  },
  label: {
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  createBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 12,
    marginTop: -20,
    shadowColor: Colors.brand.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 8,
  },
});

// ── Layout ─────────────────────────────────────────────────────────────────────

export default function TabsLayout() {
  const { user, isInitialized } = useAuthStore();

  if (isInitialized && !user) {
    return <Redirect href="/(onboarding)/welcome" />;
  }

  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="home"     />
      <Tabs.Screen name="radio"    />
      <Tabs.Screen name="memory"   />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
